import * as THREE from "three";
import * as xb from "xrblocks";
import { reportDiagnostic } from "./diagnostics/BrowserDiagnostics";
import { DimOSWebXRClient } from "./DimOSWebXRClient";
import { isMenuButtonPressed, type JoystickAxes } from "./navigation/WebXRJoystick";
import { type FloorPlane } from "./navigation/WebXRGroundPlacement";
import { MainMenuView } from "./presentation/MainMenuView";
import { XRBlocksRayInteraction, registerRayTarget } from "./input/XRBlocksRayInteraction";
import { PalmMenuGate } from "./input/PalmMenuGate";

export class WebXRApp extends xb.Script {
  static dependencies = { input: xb.Input };
  isReady = false;
  private mainMenu: MainMenuView | null = null;
  private worldHold: xb.SelectEvent["target"] | null = null;
  private uiGrab = false;
  private panelGrip = false;
  private panelHold: xb.SelectEvent["target"] | null = null;
  private menuWasPressed = false;
  private session: XRSession | null = null;
  private reference: XRReferenceSpace | null = null;
  private tracking = false;
  private menuWasVisible = false;
  private readonly palm = new PalmMenuGate();
  private readonly navigationFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  private interaction!: XRBlocksRayInteraction;
  private lastFrameTime: number | null = null;
  private palmOpened = false;
  private readonly onReset = (event: Event) => {
    const transform = (event as XRReferenceSpaceEvent).transform;
    reportDiagnostic("reference-space-reset", { compensated: Boolean(transform) });
    if (!transform || !this.reference) { this.resetTracking(); return; }
    // Keep the application in its original coordinates after a runtime recenter.
    const reference = this.reference.getOffsetReferenceSpace(transform.inverse);
    xb.core.renderer.xr.setReferenceSpace(reference);
    this.reference.removeEventListener("reset", this.onReset);
    this.reference = reference;
    reference.addEventListener("reset", this.onReset);
    this.suspendTracking();
  };
  private readonly onVisibility = () => {
    if (this.session?.visibilityState !== "visible") this.suspendTracking();
  };
  private readonly onInputChange = () => { this.clearInput(); };

  constructor(private readonly client: DimOSWebXRClient) { super(); }

  override init({ input }: { input: xb.Input }): void {
    this.interaction = new XRBlocksRayInteraction(input);
    const client = this.client;
    this.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    this.add(client.robot.object, client.lidar.object, client.route.object,
      client.markers.object, client.navigation.marker.object);
    this.navigationFloor.name = "Navigation floor";
    this.navigationFloor.rotation.x = -Math.PI / 2;
    this.navigationFloor.visible = false;
    this.navigationFloor.raycast = (raycaster, hits) => {
      if (this.navigationFloor.visible) THREE.Mesh.prototype.raycast.call(this.navigationFloor, raycaster, hits);
    };
    registerRayTarget(this.navigationFloor);
    this.add(this.navigationFloor);
    this.mainMenu = new MainMenuView({
      onSetup: () => client.ui.nextSetup(),
      onBack: () => client.ui.previousSetup(),
      onRetry: () => client.ui.retryConnection(),
      onRestart: () => client.restartSetup(),
      onMenu: () => client.ui.toggleMenu(),
      onMode: () => {
        if (!client.ui.snapshot().agentAvailable) return;
        client.loseInput();
        client.ui.setOperatingMode(client.ui.operatingMode === "manual" ? "agent" : "manual");
      },
      onDebug: () => { client.ui.debugEnabled = !client.ui.debugEnabled; },
      onLidar: () => { client.ui.cycleLidar(); },
      onLocalize: () => client.ui.restartLocalization(),
      onEstop: () => { client.loseInput(); client.ui.estop(); },
      onAgentText: text => client.speech.submitTyped(text),
    });
    this.add(this.mainMenu.panel);
    client.start();
    this.isReady = true;
    reportDiagnostic("app-initialized");
  }

  override onXRSessionStarted(session?: XRSession): void {
    if (!session || session === this.session) return;
    this.detachSession();
    this.session = session;
    reportDiagnostic("session-start", { visibility: session.visibilityState });
    session.addEventListener("visibilitychange", this.onVisibility);
    session.addEventListener("inputsourceschange", this.onInputChange);
    this.resetTracking();
  }

  override onXRSessionEnded(): void {
    this.resetTracking();
    this.detachSession();
    reportDiagnostic("session-end");
    this.client.session.stop();
    this.client.restartSetup();
  }

  override update(time = performance.now(), frame?: XRFrame): void {
    if (!this.session || !frame || this.session.visibilityState !== "visible") return;
    const xr = xb.core.renderer.xr;
    const reference = this.reference ?? xr.getReferenceSpace();
    if (!reference) return;
    if (!this.reference) {
      this.reference = reference;
      reference.addEventListener("reset", this.onReset);
    }
    // The saved space remains valid for this entire immersive session, including
    // focus changes. A new wrapper from the renderer is not lost tracking.
    if (xr.getReferenceSpace() !== reference) xr.setReferenceSpace(reference);
    const viewer = frame.getViewerPose(reference);
    if (!viewer || viewer.emulatedPosition) {
      if (this.tracking) this.suspendTracking();
      return;
    }
    if (!this.tracking) {
      this.tracking = true;
      this.interaction.setEnabled(true);
      this.client.resumeTracking();
      if (this.client.ui.wizardStep === "localization" && !this.client.originStore.hasTrackingOrigin &&
          this.client.episode.view().phase === "idle") this.client.ui.restartLocalization();
    }
    const deltaS = this.lastFrameTime === null ? 0 : Math.min(0.1, Math.max(0, (time - this.lastFrameTime) / 1000));
    this.lastFrameTime = time;
    const { position: p, orientation: q } = viewer.transform;
    this.client.tick({ position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] }, this.readJoystick());
    this.client.robot.orientFeedback(new THREE.Vector3(p.x, p.y, p.z));
    const menu = Array.from(this.session.inputSources).some(source =>
      source.gamepad && isMenuButtonPressed(source.gamepad.buttons));
    if (menu && !this.menuWasPressed) {
      this.client.ui.toggleMenu();
      this.palmOpened = false;
    }
    this.menuWasPressed = menu;
    this.syncPalm(frame, reference);
    const snap = this.client.ui.snapshot();
    const visible = snap.menuOpen || !snap.setupCompleted;
    if (visible && !this.menuWasVisible) this.placeMenuInFront(p, q);
    else if (visible && snap.setupCompleted && !this.panelHold) this.placeMenuInFront(p, q, 1 - Math.exp(-0.55 * deltaS));
    if (visible && !this.menuWasVisible) {
      reportDiagnostic("panel-visible", {
        position: this.mainMenu?.panel.position.toArray(),
        input: Array.from(this.session.inputSources).map(source => ({ handedness: source.handedness, hand: Boolean(source.hand), controller: Boolean(source.gamepad) })),
      });
    }
    this.menuWasVisible = visible;
    this.mainMenu?.apply(snap, this.client.speech.snapshot());
    this.navigationFloor.visible = this.client.controlsEnabled() && this.client.robot.floorWorldY() !== null;
    this.navigationFloor.position.y = this.client.robot.floorWorldY() ?? 0;
    if (!this.client.controlsEnabled()) {
      this.worldHold = null;
      this.client.loseInput();
    }
    this.interaction.update();
    if (this.panelHold) {
      const ray = this.interaction.ray(this.panelHold);
      this.mainMenu?.updateManipulation(ray.origin, ray.direction, this.panelHold.getWorldQuaternion(new THREE.Quaternion()), deltaS);
    }
    if (this.worldHold && !this.uiGrab) {
      const ray = this.interaction.ray(this.worldHold);
      this.client.holdNavigation(ray.origin, ray.direction, this.navigationFloorPlanes());
    }
  }

  override onSelectStart(event: xb.SelectEvent): void {
    if (!this.tracking || this.panelHold || this.session?.visibilityState !== "visible") return;
    const ray = this.interaction.ray(event.target);
    const hit = this.interaction.hit(event.target);
    reportDiagnostic("ray-select", { hand: event.target.inputSource?.handedness, surface: hit?.object.name, distanceM: hit?.distance });
    if (this.mainMenu?.ownsTarget(hit?.object)) {
      this.uiGrab = true;
      if (this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()))) {
        this.panelHold = event.target;
        this.palmOpened = false;
      }
      this.client.loseInput();
      return;
    }
    if (hit?.object === this.client.navigation.marker.cancelObject) {
      this.client.cancelNavigation();
      this.uiGrab = true;
      return;
    }
    if (!this.client.controlsEnabled() || !hit) return;
    this.worldHold = event.target;
    this.client.holdNavigation(ray.origin, ray.direction, this.navigationFloorPlanes());
  }

  override onSqueezeStart(event: xb.SelectEvent): void {
    if (!this.tracking || this.panelHold || this.session?.visibilityState !== "visible") return;
    if (!this.mainMenu?.ownsTarget(this.interaction.hit(event.target)?.object)) return;
    const ray = this.interaction.ray(event.target);
    this.clearInput();
    if (!this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()), true)) return;
    this.panelHold = event.target;
    this.panelGrip = true;
    this.uiGrab = true;
    this.palmOpened = false;
  }

  override onSqueezeEnd(event: xb.SelectEvent): void {
    if (this.panelGrip && this.panelHold === event.target) this.clearInput();
  }

  override onSelectEnd(event: xb.SelectEvent): void {
    if (this.panelGrip || (this.panelHold && this.panelHold !== event.target) ||
        (this.worldHold && this.worldHold !== event.target)) return;
    if (this.worldHold === event.target && !this.uiGrab && this.client.controlsEnabled()) {
      const ray = this.interaction.ray(event.target);
      this.client.releaseNavigation(ray.origin, ray.direction, this.navigationFloorPlanes());
    }
    this.clearInput();
  }

  override dispose(): void {
    this.detachSession();
    this.interaction.dispose();
    this.client.dispose();
    this.navigationFloor.geometry.dispose();
    this.navigationFloor.material.dispose();
    this.mainMenu?.panel.traverse(object => {
      if (object instanceof xb.TextView) object.dispose();
    });
    this.mainMenu?.panel.removeFromParent();
    super.dispose();
  }

  private clearInput(): void {
    this.worldHold = null;
    this.panelHold = null;
    this.panelGrip = false;
    this.mainMenu?.endManipulation();
    this.uiGrab = false;
    this.client.loseInput();
  }

  private suspendTracking(): void {
    this.clearInput();
    this.navigationFloor.visible = false;
    this.lastFrameTime = null;
    this.interaction.setEnabled(false);
    this.client.suspend();
    this.tracking = false;
    reportDiagnostic("tracking-suspended", { visibility: this.session?.visibilityState });
  }

  private resetTracking(): void {
    this.clearInput();
    this.navigationFloor.visible = false;
    this.lastFrameTime = null;
    this.interaction.setEnabled(false);
    this.client.invalidateTracking();
    this.tracking = false;
    this.palm.reset();
    this.palmOpened = false;
    this.menuWasVisible = false;
  }

  private detachSession(): void {
    this.interaction?.setEnabled(false);
    this.lastFrameTime = null;
    this.session?.removeEventListener("visibilitychange", this.onVisibility);
    this.session?.removeEventListener("inputsourceschange", this.onInputChange);
    this.reference?.removeEventListener("reset", this.onReset);
    this.session = null;
    this.reference = null;
  }

  private navigationFloorPlanes(): FloorPlane[] {
    const floor = this.client.robot.floorWorldY();
    return floor === null ? [] : [{ position: [0, floor, 0], normal: [0, 1, 0] }];
  }

  private readJoystick(): JoystickAxes | null {
    const source = Array.from(this.session?.inputSources ?? []).find(source => source.handedness === "left" && source.gamepad);
    const axes = source?.gamepad?.axes;
    if (!axes || axes.length < 2 || this.uiGrab) return null;
    return { x: axes.length >= 4 ? axes[2] : axes[0], y: axes.length >= 4 ? axes[3] : axes[1] };
  }

  private placeMenuInFront(p: DOMPointReadOnly, q: DOMPointReadOnly, alpha = 1): void {
    const panel = this.mainMenu?.panel;
    if (!panel) return;
    const orientation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const eye = new THREE.Vector3(p.x, p.y, p.z);
    const target = new THREE.Vector3(0, 0, -0.9).applyQuaternion(orientation).add(eye);
    target.y -= 0.18;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0)),
    );
    panel.position.lerp(target, alpha);
    panel.quaternion.slerp(rotation, alpha);
  }

  private syncPalm(frame: XRFrame, reference: XRReferenceSpace): void {
    const source = Array.from(this.session?.inputSources ?? []).find(source => source.handedness === "left" && source.hand);
    const joint = (name: XRHandJoint) => {
      const space = source?.hand?.get(name);
      return space ? frame.getJointPose?.(space, reference) : null;
    };
    const wrist = joint("wrist");
    const middle = joint("middle-finger-phalanx-intermediate");
    const index = joint("index-finger-phalanx-intermediate");
    let dotUp: number | null = null;
    if (wrist && middle && index) {
      const point = (pose: XRJointPose) => new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      const forward = point(middle).sub(point(wrist));
      const across = point(index).sub(point(middle));
      const normal = across.cross(forward).negate();
      if (normal.lengthSq() > 1e-8) dotUp = normal.normalize().y;
    }
    if (this.palm.update(dotUp, performance.now() / 1000) && this.client.ui.setupCompleted) {
      if (this.palm.isOpen) {
        this.client.ui.menuOpen = true;
        this.palmOpened = true;
      } else if (this.palmOpened) {
        this.client.ui.menuOpen = false;
        this.palmOpened = false;
      }
    }

  }
}

