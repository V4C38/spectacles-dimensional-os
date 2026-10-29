import { FingertipButtons } from "./FingertipButtons";
import { ViewerPanelPlacement } from "../presentation/ViewerPanelPlacement";
import * as THREE from "three";
import * as xb from "xrblocks";

import { reportDiagnostic } from "../diagnostics/BrowserDiagnostics";
import type { DimOSWebXRClient } from "../DimOSWebXRClient";
import { isMenuButtonPressed, type JoystickAxes } from "../navigation/WebXRJoystickController";
import { FLOOR_AIM_RANGE_M, navigationSurfaceHits, planeNormalFromPose, solveMeshPlacement, type FloorPlane } from "../navigation/WebXRGroundPlacement";
import { ScrollableTextView } from "../presentation/ScrollableTextView";
import { MainMenuView } from "../presentation/MainMenuView";
import { XRBlocksRayInteraction, markRayAmbient, markRayPassive, preferredPointer, registerRayTarget } from "./XRBlocksRayInteraction";
import { InteractionSoundController } from "../presentation/InteractionSoundController";
import { InteractionCapture } from "./InteractionCapture";
import { MenuAnchorController } from "./MenuAnchorController";
import { PalmMenuGate, palmUpDot } from "./PalmMenuGate";
import { WebXRHandStyle } from "./WebXRHandStyle";
import { worldMarkerHover } from "@dimos-ar-client/presentation/WorldVisualStyle";

type WebXRInputClient = Pick<DimOSWebXRClient,
  "manipulation" | "ui" | "originStore" | "session" | "episode" | "robot" | "navigation" | "joystick" | "speech" |
  "restartSetup" | "realign" | "cameraPreview" |
  "controlsEnabled" | "isRobotSelected" | "toggleRobotSelection" | "holdNavigation" |
  "releaseNavigation" | "aimNavigation" | "loseInput" | "emergencyStop" | "cancelNavigation">;

export class WebXRInputController {
  readonly sound = new InteractionSoundController();
  private disposed = false;
  private mainMenu: MainMenuView | null = null;
  private worldHold: xb.SelectEvent["target"] | null = null;
  private holdFromMarker = false;
  private secondaryPressed = false;
  private speedHold: THREE.Object3D | null = null;
  private speedDrag: xb.FreestandingSlider | null = null;
  private manipulationHold: xb.SelectEvent["target"] | null = null;
  private detectedSurfaces: FloorPlane[] = [];
  private readonly placementBlocker = new THREE.Object3D();
  private uiGrab = false;
  private touchDispatch = false;
  private readonly touches = new FingertipButtons<xb.SelectEvent["target"]>({
    start: (source, contact) => this.dispatchTouch(source, contact, true, false),
    end: (source, contact, cancelled) => this.dispatchTouch(source, contact, false, cancelled),
  });
  private readonly capture = new InteractionCapture<xb.SelectEvent["target"]>();
  private scrollHold: { view: ScrollableTextView; startY: number; offset: number; bar: boolean } | null = null;
  private panelGrip = false;
  private panelHold: xb.SelectEvent["target"] | null = null;
  private menuWasPressed = false;
  private reviewWasVisible = false;
  private setupWasVisible = false;
  private readonly setupPlacement = new ViewerPanelPlacement();
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
  private palmOpened = false;
  private get session(): XRSession | null { return this.trackingState.session(); }
  private get tracking(): boolean { return this.trackingState.tracking(); }
  get menu(): MainMenuView | null { return this.mainMenu; }
  get rays(): XRBlocksRayInteraction { return this.interaction; }
  get floor(): THREE.Mesh { return this.navigationFloor; }
  get holdingWorld() { return this.worldHold; }
  get holdingPanel() { return this.panelHold; }
  get scrolling() { return this.scrollHold; }
  get anchor() { return this.menuAnchor; }
  get setupPosition() { return this.setupPlacement; }
  get grippingPanel(): boolean { return this.panelGrip; }

  constructor(private readonly client: WebXRInputClient,
    private readonly scene: Pick<THREE.Object3D, "add">,
    private readonly trackingState: { session(): XRSession | null; tracking(): boolean }) {}

  setEnabled(enabled: boolean): void { this.interaction?.setEnabled(enabled); }

  inputSourcesChanged(): void {
    this.clearInput();
    for (const [handedness, gate] of this.palmGates) {
      if (!Array.from(this.session?.inputSources ?? []).some(source => source.hand && source.handedness === handedness)) gate.reset();
    }
    if (this.menuAnchor.source && !Array.from(this.session?.inputSources ?? []).includes(this.menuAnchor.source)) {
      this.menuAnchor.detach(); this.palmOpened = false;
    }
  }

  init({ input }: { input: xb.Input }): void {
    this.input = input;
    this.interaction = new XRBlocksRayInteraction(input);
    const client = this.client;
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
    this.scene.add(this.navigationFloor);
    this.mainMenu = new MainMenuView({
      canActivate: (id, target) => (this.touchDispatch || !this.input.controllers.some(source => source.userData.id === id && this.touches.owns(source))) && this.capture.activate(id, target),
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
      manipulationSpeed: () => client.manipulation.interaction.speedScale,
      onDebug: () => { client.ui.debugEnabled = !client.ui.debugEnabled; },
      onLidar: () => { client.ui.cycleLidar(); },
      onLidarMode: mode => client.ui.setLidarMode(mode),
      onLidarRange: direction => client.ui.adjustLidarRange(direction),
      onLidarPoints: direction => client.ui.adjustLidarPoints(direction),
      onDismissAlignment: () => client.ui.dismissAlignmentReview(),
      onLocalize: () => client.ui.restartLocalization(),
      onRealign: () => client.realign(),
      onEstop: () => client.emergencyStop(),
      onAgentText: text => client.speech.submitTyped(text),
      onDraft: text => client.speech.setDraft(text),
      onSound: () => this.sound.toggle(), soundEnabled: () => this.sound.enabled,
      onActivate: () => this.sound.play("activate"),
    });
    this.scene.add(this.mainMenu.panel);
    this.interaction.setPolicy({
      eligible: (controller, object, point) => this.canInteract(controller, object, point),
      ignored: (controller, object) => object === this.client.robot.collider && this.client.navigation.interaction.ownsDraft(this.navigationSourceId(controller)),
      captured: controller => this.capture.owner === controller && (this.uiGrab || this.worldHold === controller || this.manipulationHold === controller || this.panelHold === controller),
      unobstructed: (object, origin, point) => {
        if (this.mainMenu?.ownsTarget(object)) return true;
        const direction = point.clone().sub(origin).normalize();
        const hit = navigationSurfaceHits(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], this.detectedSurfaces, this.client.robot.floorWorldY() ?? 0)[0];
        return !hit || new THREE.Vector3(...hit.position).distanceTo(origin) + 0.02 >= point.distanceTo(origin);
      },
    });
  }

  update(time: number, frame: XRFrame, viewer: XRViewerPose, reference: XRReferenceSpace, deltaS: number): void {
    if (!this.session) return;
    const { position: p, orientation: q } = viewer.transform;
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
    const reviewVisible = snap.alignmentReview?.pending === true;
    const setupVisible = !snap.setupCompleted || snap.setupCelebrating === true || reviewVisible;
    const setupOpening = setupVisible && (!this.setupWasVisible || reviewVisible !== this.reviewWasVisible);
    this.reviewWasVisible = reviewVisible;
    const visible = snap.menuOpen || setupVisible;
    if (setupVisible && this.mainMenu) {
      this.menuAnchor.detach();
      if (setupOpening) this.setupPlacement.begin();
      if (!this.panelHold) this.setupPlacement.update(this.mainMenu.panel, new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(q.x, q.y, q.z, q.w), deltaS, setupOpening);
    } else {
      if (visible && !this.menuWasVisible && !this.menuAnchor.source) this.placeMenuInFront(p, q);
      if (visible && this.menuAnchor.source && !this.panelHold) {
        const position = this.anchorPosition(this.menuAnchor.source, frame, reference);
        if (position && this.mainMenu) this.menuAnchor.update(position, new THREE.Vector3(p.x, p.y, p.z), this.mainMenu.panel, deltaS);
      }
    }
    this.setupWasVisible = setupVisible;
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
    this.navigationFloor.visible = this.client.controlsEnabled() && this.client.session.view().capabilities?.navigation.available === true && this.client.robot.floorWorldY() !== null;
    this.navigationFloor.position.y = this.client.robot.floorWorldY() ?? 0;
    if (!this.client.controlsEnabled()) {
      if (this.worldHold) this.capture.cancel();
      this.worldHold = null;
      this.client.navigation.cancelDrag();
      this.client.joystick.loseInput();
    }
    this.detectedSurfaces = this.readDetectedSurfaces(frame, reference);
    this.client.ui.surfaceCount = this.detectedSurfaces.length;
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
    const hoverTargets = this.interaction.hoverTargets(this.client.robot.collider);
    const manipulationHovered = actionableHits.find(hit => hit && this.client.manipulation.owns(hit));
    this.client.manipulation.renderer.hoveredLink = manipulationHovered?.userData.manipulationLink ?? null;
    this.client.manipulation.renderer.hoveredAction = manipulationHovered?.userData.manipulationAction ?? null;
    this.client.manipulation.renderer.eeHovered = actionableHits.some(hit => !!hit && (hit === this.client.manipulation.renderer.handle.collider || hit.userData.manipulationAction === "gripper"));
    const robotHovered = hoverTargets.includes(this.client.robot.collider);
    const markerHovered = hoverTargets.some(hit => hit !== this.client.navigation.marker.cancelObject && isDescendant(hit, this.client.navigation.marker.object));
    const worldHover = worldMarkerHover(this.client.navigation.interaction.snapshot().attachedToRobot, robotHovered, markerHovered);
    this.client.robot.setHovered(worldHover.robot);
    this.sound.setActive(true);
    this.sound.setSuppressed(["Starting microphone…", "Listening", "Transcribing…", "Responding"].includes(this.client.speech.snapshot().status));
    const hovered = manipulationHovered ?? (robotHovered ? this.client.robot.object : actionableHits.some(hit => !!hit && hit !== this.client.navigation.marker.cancelObject && isDescendant(hit, this.client.navigation.marker.object)) ? this.client.navigation.marker.object : null);
    this.sound.update(hovered ?? null, this.client.isRobotSelected(), this.client.navigation.isDragging() || !!this.worldHold || !!this.manipulationHold,
      this.client.navigation.marker.object.position, time / 1000);
    this.client.navigation.marker.setHovered(worldHover.marker);
    const connectedSources = new Set<string>();
    for (const pointer of this.input.controllers) {
      const sourceId = this.navigationSourceId(pointer);
      if (!pointer.visible || pointer.userData.connected !== true) { this.client.navigation.clearAim(sourceId); continue; }
      connectedSources.add(sourceId);
      if (this.worldHold === pointer || this.uiGrab && this.capture.owner === pointer) continue;
      const target = this.interaction.hit(pointer)?.object;
      if (target === this.navigationFloor) {
        const ray = this.interaction.smoothedRay(pointer);
        this.client.aimNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), sourceId);
      } else this.client.navigation.clearAim(sourceId);
    }
    const placement = this.client.navigation.interaction.snapshot();
    for (const probe of placement.probes) if (!connectedSources.has(probe.sourceId)) this.client.navigation.clearAim(probe.sourceId);
    if (placement.draft && !connectedSources.has(placement.draft.ownerId)) this.client.navigation.clearAim(placement.draft.ownerId);
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
      const ray = this.panelRay(this.panelHold);
      this.mainMenu?.updateManipulation(ray.origin, ray.direction, this.panelHold.getWorldQuaternion(new THREE.Quaternion()), deltaS, new THREE.Vector3(p.x, p.y, p.z));
    }
    if (this.speedHold && this.capture.owner) {
      const ray = this.gestureRay(this.capture.owner);
      this.speedHold.updateWorldMatrix(true, false);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.speedHold.matrixWorld);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.speedHold.getWorldPosition(new THREE.Vector3()));
      const point = new THREE.Ray(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.direction)).intersectPlane(plane, new THREE.Vector3());
      if (point) { const half = this.speedHold.userData.sliderHalfWidth as number; this.client.manipulation.interaction.setSpeedScale(0.05 + THREE.MathUtils.clamp((this.speedHold.worldToLocal(point).x + half) / (2 * half), 0, 1) * 0.95); } else if(this.speedDrag) this.client.manipulation.interaction.setSpeedScale(this.speedDrag.getValue(this.capture.owner.getWorldPosition(new THREE.Vector3())));
    }
    if (this.manipulationHold) {
      const source = this.manipulationHold;
      if (!source.visible || source.userData.connected !== true || !this.client.controlsEnabled()) this.clearInput();
      else {
        const pressed = source.inputSource?.gamepad?.buttons[1]?.pressed === true;
        if (pressed && !this.secondaryPressed) this.client.manipulation.action("gripper");
        this.secondaryPressed = pressed;
        this.client.manipulation.hold(source.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], source.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number]);
      }
    }
    if (this.worldHold && !this.uiGrab) {
      const ray = this.gestureRay(this.worldHold);
      this.client.holdNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), this.holdFromMarker, this.navigationSourceId(this.worldHold));
    }
    this.interaction.updateCapturedEndpoints();
    const touchTargets: THREE.Mesh[] = [];
    this.mainMenu?.panel.traverse(object => { if (object instanceof THREE.Mesh && object.userData.touchButton) touchTargets.push(object); });
    for (const source of this.input.controllers) {
      const tip = source.visible && source.userData.connected === true ? this.interaction.direct.indexTip(source) : null;
      if (!this.touches.owns(source) && source.userData.selected === true) continue;
      this.touches.update(source, tip, touchTargets, (object, point) => this.canInteract(source, object, point));
    }
  }

  private readonly navigationSourceIds = new WeakMap<object, string>();
  private nextNavigationSource = 0;
  private navigationSourceId(controller: xb.SelectEvent["target"]): string {
    const source = controller.inputSource ?? controller;
    let id = this.navigationSourceIds.get(source);
    if (!id) { id = `${controller.inputSource?.handedness ?? "input"}-${++this.nextNavigationSource}`; this.navigationSourceIds.set(source, id); }
    return id;
  }

  private canInteract(controller: xb.SelectEvent["target"], object: THREE.Object3D, point: THREE.Vector3): boolean {
    if (!this.tracking) return false;
    if (this.capture.owner && this.capture.owner !== controller && !this.mainMenu?.isEmergencyTarget(object) && !["estop", "stop"].includes(object.userData.manipulationAction) && !(object === this.navigationFloor && this.client.isRobotSelected())) return false;
    if (this.mainMenu?.ownsTarget(object)) return this.mainMenu.canInteract(object, point);
    if (object !== this.navigationFloor) {
      const origin = controller.getWorldPosition(new THREE.Vector3());
      const direction = point.clone().sub(origin).normalize();
      const surface = navigationSurfaceHits(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], this.detectedSurfaces, this.client.robot.floorWorldY() ?? 0)[0];
      if (surface && new THREE.Vector3(...surface.position).distanceTo(origin) + 0.02 < point.distanceTo(origin)) return false;
    }
    if (object === this.client.robot.collider && this.client.navigation.interaction.ownsDraft(this.navigationSourceId(controller))) return false;
    if (object === this.client.robot.collider) return this.client.ui.snapshot().robotSelectable;
    if (!this.client.controlsEnabled() || !this.client.originStore.hasTrackingOrigin) return false;
    if (object === this.navigationFloor) return this.client.isRobotSelected() && point.distanceTo(controller.getWorldPosition(new THREE.Vector3())) <= FLOOR_AIM_RANGE_M;
    if (this.client.manipulation.owns(object)) return object.userData.interactionEnabled !== false;
    return isDescendant(object, this.client.navigation.marker.object) && object.userData.rayDisabled !== true;
  }

  onSelectStart(event: xb.SelectEvent): void {
    if (!this.touchDispatch && this.touches.owns(event.target)) return;
    if (!this.tracking || this.session?.visibilityState !== "visible") return;
    const hit = this.interaction.hit(event.target);
    if (this.mainMenu?.isEmergencyTarget(hit?.object) || hit?.object.userData.manipulationAction === "estop") {
      this.clearInput();
      this.client.emergencyStop();
      return;
    }
    if (!hit || !this.canInteract(event.target, hit.object, hit.point)) return;
    if (hit.object.userData.manipulationAction === "stop") {
      this.clearInput();
      this.client.manipulation.action("stop");
      return;
    }
    if (!this.capture.press(event.target, hit?.object)) return;
    if (hit.object !== this.navigationFloor && hit.object !== this.placementBlocker) this.interaction.capture(event.target, hit.object, hit.point);
    this.interaction.direct.capture(event.target, hit.object,
      isDescendant(hit.object, this.client.navigation.marker.object) ? new THREE.Vector3(0, 1, 0) : undefined);
    if (this.panelHold || this.worldHold || this.manipulationHold || this.uiGrab) return;
    if (hit.object.userData.manipulationSpeedSlider) {
      const thumb = hit.object.userData.sliderThumb as THREE.Object3D | undefined;
      if (thumb) this.interaction.capture(event.target, thumb, thumb.getWorldPosition(new THREE.Vector3()));
      this.speedHold=hit.object;this.uiGrab=true;const half=hit.object.userData.sliderHalfWidth as number;
      const start=.05+THREE.MathUtils.clamp((hit.object.worldToLocal(hit.point.clone()).x+half)/(2*half),0,1)*.95;
      this.client.manipulation.interaction.setSpeedScale(start);
      const width=2*half*hit.object.getWorldScale(new THREE.Vector3()).x;
      this.speedDrag=new xb.FreestandingSlider(start,.05,1,.95/width);
      this.speedDrag.setInitialPose(event.target.getWorldPosition(new THREE.Vector3()),hit.object.getWorldQuaternion(new THREE.Quaternion()));
      return;
    }
    if (hit.object.userData.manipulationPanel) {
      this.client.manipulation.beginPanel(event.target.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], event.target.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number]);
      this.manipulationHold = event.target; return;
    }
    if (this.client.manipulation.owns(hit.object) && this.client.controlsEnabled()) {
      const action = hit.object.userData.manipulationAction;
      if (action) { this.client.manipulation.action(action); this.uiGrab = true; }
      else if (hit.object.userData.manipulationLink) { this.client.toggleRobotSelection(); this.uiGrab = true; }
      else if (this.client.manipulation.begin(event.target.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], event.target.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number])) this.manipulationHold = event.target;
      return;
    }
    const ray = this.mainMenu?.ownsTarget(hit.object) ? this.panelRay(event.target) : this.gestureRay(event.target);
    reportDiagnostic("ray-select", { hand: event.target.inputSource?.handedness, surface: hit?.object.name, distanceM: hit?.distance });
    if (this.mainMenu?.ownsTarget(hit?.object)) {
      this.uiGrab = true;
      this.client.navigation.clearAim(this.navigationSourceId(event.target));
      this.client.joystick.loseInput();
      const scroll = this.mainMenu.scrollView(hit?.object);
      if (scroll && (hit?.object.userData.scrollbar || hit?.object.userData.bodyScrollable)) {
        const y = this.scrollPointerY(scroll, ray.origin, ray.direction);
        if (y !== null) this.scrollHold = { view: scroll, startY: y, offset: scroll.scrollOffset, bar: hit.object.userData.scrollbar === true };
        return;
      }
      if (this.mainMenu.isSpeechTarget(hit?.object)) this.client.speech.beginRecording();
      if (!this.mainMenu.isControl(hit?.object) && this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()))) {
        this.setupPlacement.pin();
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
    this.client.holdNavigation(smoothed.origin, smoothed.direction, this.navigationFloorPlanes(), this.holdFromMarker, this.navigationSourceId(event.target));
  }

  onSqueezeStart(event: xb.SelectEvent): void {
    if (!this.tracking || this.panelHold || this.worldHold || this.uiGrab || this.session?.visibilityState !== "visible") return;
    if (!this.mainMenu?.ownsTarget(this.interaction.hit(event.target)?.object)) return;
    const ray = this.panelRay(event.target);
    this.clearInput();
    if (!this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()), true)) return;
    this.capture.press(event.target, this.interaction.hit(event.target)?.object);
    const contact = this.interaction.hit(event.target);
    if (contact) this.interaction.capture(event.target, contact.object, contact.point);
    this.interaction.direct.capture(event.target, this.interaction.hit(event.target)!.object);
    this.setupPlacement.pin();
    this.panelHold = event.target;
    this.panelGrip = true;
    this.menuAnchor.detach();
    this.uiGrab = true;
    this.palmOpened = false;
  }

  onSqueezeEnd(event: xb.SelectEvent): void {
    if (this.panelGrip && this.panelHold === event.target) this.clearInput();
  }

  onSelectEnd(event: xb.SelectEvent): void {
    if (!this.touchDispatch && this.touches.owns(event.target)) { this.touches.release(event.target); return; }
    if (this.capture.owner && this.capture.owner !== event.target) return;
    if (this.panelGrip || (this.panelHold && this.panelHold !== event.target) ||
        (this.worldHold && this.worldHold !== event.target)) return;
    if (this.worldHold === event.target && !this.uiGrab && this.client.controlsEnabled()) {
      const ray = this.gestureRay(event.target);
      this.client.releaseNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), this.navigationSourceId(event.target));
      this.sound.play("confirm");
    }
    this.clearInput(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.touches.cancel();
    this.sound.dispose();
    this.interaction.dispose();
    this.handStyle.dispose();
    this.navigationFloor.geometry.dispose();
    this.navigationFloor.material.dispose();
    this.mainMenu?.dispose();
    this.mainMenu?.panel.removeFromParent();
  }

  private dispatchTouch(source: xb.SelectEvent["target"], contact: { object: THREE.Mesh; point: THREE.Vector3; distance: number }, start: boolean, cancelled: boolean): void {
    this.touchDispatch = true;
    try {
      const event: { type: "selectstart" | "selectend"; target: xb.SelectEvent["target"] } = { type: start ? "selectstart" : "selectend", target: source };
      if (start) this.input.defaultOnSelectStart(event);
      else this.input.defaultOnSelectEnd(event);
      if (cancelled) this.capture.cancel();
      this.input.intersectionsForController.set(source, [contact]);
      if (start) { xb.core.user.onSelectStart(event); this.onSelectStart(event); }
      else {
        // A physical pinch release may already have retired the SDK's selection.
        // Re-register the captured button, preserving the original activation guard.
        const pressEvent = { ...event, type: "selectstart" as const };
        xb.core.user.onSelectStart(pressEvent);
        xb.core.user.onSelectEnd(event);
        if (cancelled) this.clearInput(); else this.onSelectEnd(event);
      }
    } finally { this.touchDispatch = false; }
  }

  private panelRay(controller: xb.SelectEvent["target"]): { origin: [number, number, number]; direction: [number, number, number] } {
    return this.interaction.direct.ray(controller) ?? this.interaction.ray(controller);
  }

  private gestureRay(controller: xb.SelectEvent["target"]): { origin: [number, number, number]; direction: [number, number, number] } {
    return this.interaction.direct.ray(controller) ?? this.interaction.smoothedRay(controller);
  }

  private clearInput(completeDictation = false): void {
    if (this.manipulationHold) {
      if (completeDictation) this.client.manipulation.end();
      else this.client.manipulation.interrupt();
    }
    this.manipulationHold = null;
    this.speedHold = null;
    this.speedDrag = null;
    this.secondaryPressed = false;
    this.interaction.direct.cancel();
    this.interaction.releaseCaptures();
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

  suspend(): void {
    this.touches.cancel();
    this.client.robot.setHovered(false);
    this.client.navigation.marker.setHovered(false);
    this.sound.setActive(false);
    this.clearInput();
    this.navigationFloor.visible = false;
    this.interaction.setEnabled(false);
  }

  reset(): void {
    this.reviewWasVisible = false;
    this.setupWasVisible = false;
    this.sound.setActive(false);
    this.clearInput();
    this.navigationFloor.visible = false;
    this.interaction.setEnabled(false);
    for (const gate of this.palmGates.values()) gate.reset();
    this.menuAnchor.detach();
    this.palmOpened = false;
    this.menuWasVisible = false;
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

  readJoystick(): JoystickAxes | null {
    const source = Array.from(this.session?.inputSources ?? []).find(source => source.handedness === "left" && source.gamepad);
    const axes = source?.gamepad?.axes;
    if (!axes || axes.length < 2 || this.uiGrab || this.panelHold || this.worldHold) return null;
    const pointer = this.input.controllers.find(controller => controller.inputSource === source);
    if (pointer && this.mainMenu?.scrollView(this.interaction.hit(pointer)?.object)) return null;
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
      if (!this.client.ui.setupCompleted || this.client.ui.alignmentReview?.pending) continue;
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
