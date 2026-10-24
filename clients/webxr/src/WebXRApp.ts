import * as THREE from "three";
import * as xb from "xrblocks";
import { reportDiagnostic } from "./diagnostics/BrowserDiagnostics";
import { DimOSWebXRClient } from "./DimOSWebXRClient";
import { isMenuButtonPressed, type JoystickAxes } from "./navigation/WebXRJoystickController";
import { FLOOR_AIM_RANGE_M, navigationSurfaceHits, planeNormalFromPose, solveMeshPlacement, type FloorPlane } from "./navigation/WebXRGroundPlacement";
import { ScrollableTextView } from "./presentation/ScrollableTextView";
import { MainMenuView } from "./presentation/MainMenuView";
import { XRBlocksRayInteraction, markRayAmbient, markRayPassive, preferredPointer, registerRayTarget } from "./input/XRBlocksRayInteraction";
import { InteractionSoundController } from "./presentation/InteractionSoundController";
import { InteractionCapture } from "./input/InteractionCapture";
import { MenuAnchorController } from "./input/MenuAnchorController";
import { PalmMenuGate, palmUpDot } from "./input/PalmMenuGate";
import { WebXRHandStyle } from "./input/WebXRHandStyle";

export class WebXRApp extends xb.Script {
  static dependencies = { input: xb.Input };
  isReady = false;
  readonly sound = new InteractionSoundController();
  private mainMenu: MainMenuView | null = null;
  private worldHold: xb.SelectEvent["target"] | null = null;
  private holdFromMarker = false;
  private detectedSurfaces: FloorPlane[] = [];
  private readonly placementBlocker = new THREE.Object3D();
  private uiGrab = false;
  private readonly capture = new InteractionCapture<xb.SelectEvent["target"]>();
  private scrollHold: { view: ScrollableTextView; startY: number; offset: number; bar: boolean } | null = null;
  private panelGrip = false;
  private panelHold: xb.SelectEvent["target"] | null = null;
  private menuWasPressed = false;
  private session: XRSession | null = null;
  private reference: XRReferenceSpace | null = null;
  private tracking = false;
  private menuWasVisible = false;
  private readonly palmGates = new Map<XRHandedness, PalmMenuGate>();
  private readonly menuAnchor = new MenuAnchorController();
  private readonly handStyle = new WebXRHandStyle();
  private readonly navigationFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  private interaction!: XRBlocksRayInteraction;
  private input!: xb.Input;
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
  private readonly onInputChange = () => {
    this.clearInput();
    for (const [handedness, gate] of this.palmGates) {
      if (!Array.from(this.session?.inputSources ?? []).some(source => source.hand && source.handedness === handedness)) gate.reset();
    }
    if (this.menuAnchor.source && !Array.from(this.session?.inputSources ?? []).includes(this.menuAnchor.source)) {
      this.menuAnchor.detach();
      this.palmOpened = false;
    }
  };

  constructor(private readonly client: DimOSWebXRClient) { super(); }

  override init({ input }: { input: xb.Input }): void {
    this.input = input;
    this.interaction = new XRBlocksRayInteraction(input);
    const client = this.client;
    this.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    this.add(client.robot.object, client.lidar.object, client.route.object,
      client.markers.object, client.navigation.marker.object);
    this.navigationFloor.name = "Navigation floor";
    this.navigationFloor.rotation.x = -Math.PI / 2;
    this.navigationFloor.visible = false;
    this.navigationFloor.userData.rayPriority = 30;
    this.placementBlocker.userData.rayPriority = 30;
    markRayPassive(this.placementBlocker);
    this.navigationFloor.raycast = (raycaster, hits) => {
      if (!this.navigationFloor.visible) return;
      const from = raycaster.ray.origin.toArray() as [number, number, number];
      const dir = raycaster.ray.direction.toArray() as [number, number, number];
      const floorY = this.client.robot.floorWorldY() ?? 0;
      const surfaces = navigationSurfaceHits(from, dir, this.detectedSurfaces, floorY);
      const result = solveMeshPlacement({ rayFrom: from,
        rayTo: raycaster.ray.at(FLOOR_AIM_RANGE_M, new THREE.Vector3()).toArray() as [number, number, number],
        hits: surfaces, deadzone: null, wasInsideDeadzone: false, fallbackY: floorY });
      const point = new THREE.Vector3(...result.probePosition);
      const distance = point.distanceTo(raycaster.ray.origin);
      if (distance > FLOOR_AIM_RANGE_M || distance > raycaster.far || distance < raycaster.near) return;
      hits.push({ point, distance, object: result.status === "ok" ? this.navigationFloor : this.placementBlocker });
    };
    registerRayTarget(this.navigationFloor);
    markRayAmbient(this.navigationFloor);
    this.add(this.navigationFloor);
    this.mainMenu = new MainMenuView({
      canActivate: (id, target) => this.capture.activate(id, target),
      onSetup: () => client.ui.nextSetup(),
      onBack: () => client.ui.previousSetup(),
      onRetry: () => client.ui.retryConnection(),
      onRestart: () => client.restartSetup(),
      onMenu: () => client.ui.toggleMenu(),
      onMode: mode => {
        if (mode === "agent" && !client.ui.snapshot().agentAvailable) return;
        client.loseInput();
        client.ui.setOperatingMode(mode);
      },
      onRobot: () => client.toggleRobotSelection(),
      onDebug: () => { client.ui.debugEnabled = !client.ui.debugEnabled; },
      onLidar: () => { client.ui.cycleLidar(); },
      onLocalize: () => client.ui.restartLocalization(),
      onRealign: () => client.realign(),
      onEstop: () => { client.loseInput(); client.ui.estop(); },
      onAgentText: text => client.speech.submitTyped(text),
      onDraft: text => client.speech.setDraft(text),
      onSound: () => this.sound.toggle(), soundEnabled: () => this.sound.enabled,
      onActivate: () => this.sound.play("activate"),
    });
    this.add(this.mainMenu.panel);
    this.interaction.setPolicy({
      eligible: (controller, object, point) => this.canInteract(controller, object, point) &&
        (object !== this.navigationFloor || this.capture.owner === controller || preferredPointer(this.input.controllers) === controller),
      captured: controller => this.capture.owner === controller && (this.uiGrab || this.worldHold === controller || this.panelHold === controller),
      unobstructed: (object, origin, point) => {
        if (this.mainMenu?.ownsTarget(object)) return true;
        const direction = point.clone().sub(origin).normalize();
        const hit = navigationSurfaceHits(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], this.detectedSurfaces, this.client.robot.floorWorldY() ?? 0)[0];
        return !hit || new THREE.Vector3(...hit.position).distanceTo(origin) + 0.02 >= point.distanceTo(origin);
      },
    });
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
    const summoner = Array.from(this.session.inputSources).find(source => source.gamepad && isMenuButtonPressed(source.gamepad.buttons));
    const menu = Boolean(summoner);
    if (menu && !this.menuWasPressed) {
      this.client.ui.toggleMenu();
      if (this.client.ui.menuOpen && summoner) this.anchorMenu(summoner, frame, reference, p, q);
      else this.menuAnchor.detach();
      this.palmOpened = false;
    }
    this.menuWasPressed = menu;
    this.syncPalm(frame, reference, p, q);
    const snap = this.client.ui.snapshot();
    const visible = snap.menuOpen || !snap.setupCompleted || snap.setupCelebrating === true;
    if (visible && !this.menuWasVisible && !this.menuAnchor.source) this.placeMenuInFront(p, q);
    if (visible && !snap.setupCompleted && !this.panelHold && this.mainMenu) {
      this.menuAnchor.faceViewer(new THREE.Vector3(p.x, p.y, p.z), this.mainMenu.panel, 1 - Math.exp(-20 * deltaS));
    }
    if (visible && this.menuAnchor.source && !this.panelHold) {
      const position = this.anchorPosition(this.menuAnchor.source, frame, reference);
      if (position && this.mainMenu) this.menuAnchor.update(position, new THREE.Vector3(p.x, p.y, p.z), this.mainMenu.panel, deltaS);
    }
    if (!visible) this.menuAnchor.detach();
    if (visible && !this.menuWasVisible) {
      reportDiagnostic("panel-visible", {
        position: this.mainMenu?.panel.position.toArray(),
        input: Array.from(this.session.inputSources).map(source => ({ handedness: source.handedness, hand: Boolean(source.hand), controller: Boolean(source.gamepad) })),
      });
    }
    this.menuWasVisible = visible;
    this.mainMenu?.apply(snap, this.client.speech.snapshot());
    this.mainMenu?.updateCameraPreview(this.client.cameraPreview(), deltaS);
    this.navigationFloor.visible = this.client.controlsEnabled() && this.client.robot.floorWorldY() !== null;
    this.navigationFloor.position.y = this.client.robot.floorWorldY() ?? 0;
    if (!this.client.controlsEnabled()) {
      if (this.worldHold) this.capture.cancel();
      this.worldHold = null;
      this.client.navigation.cancelDrag();
      this.client.joystick.loseInput();
    }
    this.detectedSurfaces = this.readDetectedSurfaces(frame, reference);
    if (this.capture.owner && (!this.capture.owner.visible || this.capture.owner.userData.connected !== true)) this.clearInput();
    this.handStyle.apply(this.input.hands);
    this.interaction.direct.sample(frame, reference, this.input.controllers);
    if (this.interaction.direct.hasLostCapture()) this.clearInput();
    for (const controller of this.input.controllers) {
      this.input.setRaycasterFromController(controller);
      this.input.performRaycastOnScene(controller);
    }
    this.interaction.update(deltaS);
    const hits = this.input.controllers.map(controller => this.interaction.hit(controller)?.object);
    this.client.navigation.marker.update(new THREE.Vector3(p.x, p.y, p.z), hits.includes(this.client.navigation.marker.cancelObject));
    this.mainMenu?.updateHover(hits, deltaS);
    const actionableHits = this.input.controllers.map(controller => {
      const hit = this.interaction.hit(controller);
      return hit && this.canInteract(controller, hit.object, hit.point) ? hit.object : undefined;
    });
    const robotHovered = actionableHits.includes(this.client.robot.collider) ||
      [...this.interaction.beams.values()].some(beam => beam.affordance === this.client.robot.collider);
    this.client.robot.setHovered(robotHovered);
    this.sound.setActive(true);
    this.sound.setSuppressed(["Starting microphone…", "Listening", "Transcribing…", "Responding"].includes(this.client.speech.snapshot().status));
    const hovered = robotHovered ? this.client.robot.object : actionableHits.some(hit => !!hit && hit !== this.client.navigation.marker.cancelObject && isDescendant(hit, this.client.navigation.marker.object)) ? this.client.navigation.marker.object : null;
    this.sound.update(hovered ?? null, this.client.isRobotSelected(), this.client.navigation.isDragging() || !!this.worldHold,
      this.client.navigation.marker.object.position, time / 1000);
    this.client.navigation.marker.setHovered(robotHovered || actionableHits.some(hit => !!hit && isDescendant(hit, this.client.navigation.marker.object) && hit !== this.client.navigation.marker.cancelObject));
    if (!this.worldHold && !this.uiGrab) {
      const pointer = preferredPointer(this.input.controllers);
      const target = pointer ? this.interaction.hit(pointer)?.object : undefined;
      if (pointer && target === this.navigationFloor) {
        const ray = this.interaction.smoothedRay(pointer);
        this.client.aimNavigation(ray.origin, ray.direction, this.navigationFloorPlanes());
      } else this.client.navigation.clearAim();
    }
    if (this.scrollHold && this.capture.owner) {
      const ray = this.gestureRay(this.capture.owner);
      const y = this.scrollPointerY(this.scrollHold.view, ray.origin, ray.direction);
      if (y !== null) {
        const { view, startY, offset, bar } = this.scrollHold;
        view.scrollTo(offset + (y - startY) * (bar ? -view.maxScroll / view.rangeY : 1));
      }
    } else if (!this.uiGrab) {
      const pointer = preferredPointer(this.input.controllers);
      const view = pointer ? this.mainMenu?.scrollView(this.interaction.hit(pointer)?.object) : null;
      const axes = pointer?.inputSource?.gamepad?.axes;
      const axis = axes ? axes[axes.length >= 4 ? 3 : 1] ?? 0 : 0;
      if (view && Math.abs(axis) > 0.2) view.scrollBy(axis * deltaS * view.rangeY * 3);
    }
    if (this.panelHold) {
      const ray = this.gestureRay(this.panelHold);
      this.mainMenu?.updateManipulation(ray.origin, ray.direction, this.panelHold.getWorldQuaternion(new THREE.Quaternion()), deltaS);
    }
    if (this.worldHold && !this.uiGrab) {
      const ray = this.gestureRay(this.worldHold);
      this.client.holdNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), this.holdFromMarker);
    }
  }

  private canInteract(controller: xb.SelectEvent["target"], object: THREE.Object3D, point: THREE.Vector3): boolean {
    if (!this.tracking) return false;
    if (this.capture.owner && this.capture.owner !== controller && !this.mainMenu?.isEmergencyTarget(object)) return false;
    if (this.mainMenu?.ownsTarget(object)) return this.mainMenu.canInteract(object, point);
    if (object !== this.navigationFloor) {
      const origin = controller.getWorldPosition(new THREE.Vector3());
      const direction = point.clone().sub(origin).normalize();
      const surface = navigationSurfaceHits(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], this.detectedSurfaces, this.client.robot.floorWorldY() ?? 0)[0];
      if (surface && new THREE.Vector3(...surface.position).distanceTo(origin) + 0.02 < point.distanceTo(origin)) return false;
    }
    if (object === this.client.robot.collider) return this.client.ui.setupCompleted && this.client.session.view().connection === "ready";
    if (!this.client.controlsEnabled() || !this.client.originStore.hasTrackingOrigin) return false;
    if (object === this.navigationFloor) return this.client.isRobotSelected() && point.distanceTo(controller.getWorldPosition(new THREE.Vector3())) <= FLOOR_AIM_RANGE_M;
    return isDescendant(object, this.client.navigation.marker.object) && object.userData.rayDisabled !== true;
  }

  override onSelectStart(event: xb.SelectEvent): void {
    if (!this.tracking || this.session?.visibilityState !== "visible") return;
    const hit = this.interaction.hit(event.target);
    if (this.mainMenu?.isEmergencyTarget(hit?.object)) {
      this.clearInput();
      this.client.ui.estop();
      return;
    }
    if (!hit || !this.canInteract(event.target, hit.object, hit.point)) return;
    if (!this.capture.press(event.target, hit?.object)) return;
    this.interaction.direct.capture(event.target, hit.object,
      isDescendant(hit.object, this.client.navigation.marker.object) ? new THREE.Vector3(0, 1, 0) : undefined);
    if (this.panelHold || this.worldHold || this.uiGrab) return;
    const ray = this.gestureRay(event.target);
    reportDiagnostic("ray-select", { hand: event.target.inputSource?.handedness, surface: hit?.object.name, distanceM: hit?.distance });
    if (this.mainMenu?.ownsTarget(hit?.object)) {
      this.uiGrab = true;
      this.client.navigation.cancelDrag();
      this.client.joystick.loseInput();
      const scroll = this.mainMenu.scrollView(hit?.object);
      if (scroll && (hit?.object.userData.scrollbar || hit?.object.userData.bodyScrollable)) {
        const y = this.scrollPointerY(scroll, ray.origin, ray.direction);
        if (y !== null) this.scrollHold = { view: scroll, startY: y, offset: scroll.scrollOffset, bar: hit.object.userData.scrollbar === true };
        return;
      }
      if (this.mainMenu.isSpeechTarget(hit?.object)) this.client.speech.beginRecording();
      if (!this.mainMenu.isControl(hit?.object) && this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()))) {
        this.panelHold = event.target;
        this.menuAnchor.detach();
        this.palmOpened = false;
      }
      return;
    }
    if (hit?.object === this.client.navigation.marker.cancelObject) {
      this.client.cancelNavigation();
      this.uiGrab = true;
      return;
    }
    if (hit?.object === this.client.robot.collider && this.client.ui.setupCompleted) {
      this.client.toggleRobotSelection();
      this.uiGrab = true;
      return;
    }
    if (!this.client.controlsEnabled() || !hit || hit.object === this.placementBlocker) return;
    const fromMarker = isDescendant(hit.object, this.client.navigation.marker.object);
    if (!fromMarker && (hit.object !== this.navigationFloor || !this.client.isRobotSelected())) return;
    this.worldHold = event.target;
    this.holdFromMarker = fromMarker;
    const smoothed = this.gestureRay(event.target);
    this.client.holdNavigation(smoothed.origin, smoothed.direction, this.navigationFloorPlanes(), this.holdFromMarker);
  }

  override onSqueezeStart(event: xb.SelectEvent): void {
    if (!this.tracking || this.panelHold || this.worldHold || this.uiGrab || this.session?.visibilityState !== "visible") return;
    if (!this.mainMenu?.ownsTarget(this.interaction.hit(event.target)?.object)) return;
    const ray = this.gestureRay(event.target);
    this.clearInput();
    if (!this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()), true)) return;
    this.capture.press(event.target, this.interaction.hit(event.target)?.object);
    this.interaction.direct.capture(event.target, this.interaction.hit(event.target)!.object);
    this.panelHold = event.target;
    this.panelGrip = true;
    this.menuAnchor.detach();
    this.uiGrab = true;
    this.palmOpened = false;
  }

  override onSqueezeEnd(event: xb.SelectEvent): void {
    if (this.panelGrip && this.panelHold === event.target) this.clearInput();
  }

  override onSelectEnd(event: xb.SelectEvent): void {
    if (this.capture.owner && this.capture.owner !== event.target) return;
    if (this.panelGrip || (this.panelHold && this.panelHold !== event.target) ||
        (this.worldHold && this.worldHold !== event.target)) return;
    if (this.worldHold === event.target && !this.uiGrab && this.client.controlsEnabled()) {
      const ray = this.gestureRay(event.target);
      this.client.releaseNavigation(ray.origin, ray.direction, this.navigationFloorPlanes());
      this.sound.play("confirm");
    }
    this.clearInput(true);
  }

  override dispose(): void {
    this.detachSession();
    this.sound.dispose();
    this.interaction.dispose();
    this.handStyle.dispose();
    this.client.dispose();
    this.navigationFloor.geometry.dispose();
    this.navigationFloor.material.dispose();
    this.mainMenu?.dispose();
    this.mainMenu?.panel.removeFromParent();
    super.dispose();
  }

  private gestureRay(controller: xb.SelectEvent["target"]): { origin: [number, number, number]; direction: [number, number, number] } {
    return this.interaction.direct.ray(controller) ?? this.interaction.smoothedRay(controller);
  }

  private clearInput(completeDictation = false): void {
    this.interaction.direct.cancel();
    if (completeDictation && this.capture.owner) this.capture.release(this.capture.owner);
    else this.capture.cancel();
    this.worldHold = null;
    this.scrollHold = null;
    this.panelHold = null;
    this.panelGrip = false;
    this.mainMenu?.endManipulation();
    this.uiGrab = false;
    this.client.loseInput(completeDictation);
  }

  private suspendTracking(): void {
    this.sound.setActive(false);
    this.clearInput();
    this.navigationFloor.visible = false;
    this.lastFrameTime = null;
    this.interaction.setEnabled(false);
    this.client.suspend();
    this.tracking = false;
    reportDiagnostic("tracking-suspended", { visibility: this.session?.visibilityState });
  }

  private resetTracking(): void {
    this.sound.setActive(false);
    this.clearInput();
    this.navigationFloor.visible = false;
    this.lastFrameTime = null;
    this.interaction.setEnabled(false);
    this.client.invalidateTracking();
    this.tracking = false;
    for (const gate of this.palmGates.values()) gate.reset();
    this.menuAnchor.detach();
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

  private scrollPointerY(view: ScrollableTextView, from: [number, number, number], dir: [number, number, number]): number | null {
    view.updateWorldMatrix(true, false);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(view.getWorldQuaternion(new THREE.Quaternion()));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, view.getWorldPosition(new THREE.Vector3()));
    const point = new THREE.Ray(new THREE.Vector3(...from), new THREE.Vector3(...dir)).intersectPlane(plane, new THREE.Vector3());
    return point ? view.worldToLocal(point).y : null;
  }

  private navigationFloorPlanes(): FloorPlane[] {
    return this.detectedSurfaces;
  }

  private readDetectedSurfaces(frame: XRFrame, reference: XRReferenceSpace): FloorPlane[] {
    const surfaces: FloorPlane[] = [];
    for (const plane of frame.detectedPlanes ?? []) {
      const pose = frame.getPose(plane.planeSpace, reference);
      if (!pose) continue;
      const { position: p, orientation: q } = pose.transform;
      const rotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      const position = new THREE.Vector3(p.x, p.y, p.z);
      surfaces.push({
        position: position.toArray() as [number, number, number],
        normal: planeNormalFromPose([q.x, q.y, q.z, q.w]),
        label: plane.semanticLabel || undefined,
        polygon: plane.polygon.map(point => new THREE.Vector3(point.x, point.y, point.z)
          .applyQuaternion(rotation).add(position).toArray() as [number, number, number]),
      });
    }
    return surfaces;
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

  private anchorPosition(source: XRInputSource, frame: XRFrame, reference: XRReferenceSpace): THREE.Vector3 | null {
    const wrist = source.hand?.get("wrist");
    const pose = wrist ? frame.getJointPose?.(wrist, reference) : frame.getPose?.(source.gripSpace ?? source.targetRaySpace, reference);
    const p = pose?.transform.position;
    return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
  }

  private anchorMenu(source: XRInputSource, frame: XRFrame, reference: XRReferenceSpace, eye: DOMPointReadOnly, rotation: DOMPointReadOnly): void {
    const position = this.anchorPosition(source, frame, reference);
    if (!position || !this.mainMenu) return;
    this.menuAnchor.attach(source, position, new THREE.Vector3(eye.x, eye.y, eye.z), new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), this.mainMenu.panel);
  }

  private syncPalm(frame: XRFrame, reference: XRReferenceSpace, eye: DOMPointReadOnly, rotation: DOMPointReadOnly): void {
    const sources = Array.from(this.session?.inputSources ?? []).filter(source => source.hand);
    for (const source of sources) {
      const gate = this.palmGates.get(source.handedness) ?? new PalmMenuGate();
      this.palmGates.set(source.handedness, gate);
      const joints = new Map<string, THREE.Vector3>();
      for (const name of ["wrist", "index-finger-metacarpal", "middle-finger-metacarpal", "pinky-finger-metacarpal", ...["middle", "ring"].flatMap(finger => [`${finger}-finger-phalanx-proximal`, `${finger}-finger-phalanx-intermediate`, `${finger}-finger-tip`])]) {
        const space = source.hand?.get(name as XRHandJoint);
        const pose = space && frame.getJointPose?.(space, reference);
        if (pose) joints.set(name, new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z));
      }
      const changed = gate.update(palmUpDot(source.handedness, joints), performance.now() / 1000);
      if (!this.client.ui.setupCompleted) continue;
      if (changed && gate.isOpen && !this.client.ui.menuOpen) {
        this.client.ui.menuOpen = true;
        this.anchorMenu(source, frame, reference, eye, rotation);
        this.palmOpened = true;
      } else if (!gate.isOpen && this.palmOpened && this.menuAnchor.source === source && !this.capture.owner) {
        this.client.ui.menuOpen = false;
        this.menuAnchor.detach();
        this.palmOpened = false;
      }
    }
  }

}

function isDescendant(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node === ancestor) return true;
  }
  return false;
}
