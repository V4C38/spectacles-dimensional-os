import { ManipulationInputCapture, ManipulationPressEdges } from "@dimos-ar-client/manipulation/ManipulationInput";
import { FingertipButtons, FLOOR_AIM_RANGE_M, navigationSurfaceHits, planeNormalFromPose, solveMeshPlacement, type FloorPlane, XRBlocksRayInteraction, markRayAmbient, markRayPassive, preferredPointer, registerRayTarget, InteractionCapture } from "./WebXRInteraction";
import { ViewerPanelPlacement, isMenuButtonPressed, MenuAnchorController, PalmMenuGate, palmUpDot } from "../presentation/PanelInteraction";
import * as THREE from "three";
import * as xb from "xrblocks";

import { reportDiagnostic } from "../diagnostics/Diagnostics";
import type { WebXRManipulationController } from "../manipulation/WebXRManipulationController";
import type { WebXRNavigationController } from "../navigation/WebXRNavigationController";
import type { WebXRRobotPresenter } from "../presentation/WebXRRobotPresenter";
import type { WebXRUIPresenter } from "../presentation/WebXRUIPresenter";
import type { CameraPreviewFrame } from "../presentation/SetupCameraPreviewView";
import type { AgentDraftSession } from "@dimos-ar-client/agent/AgentDraftSession";
import type { Vec3 } from "@dimos-ar-client/ClientContracts";
import type { JoystickAxes } from "@dimos-ar-client/navigation/NavigationCommands";

import type { ScrollableTextView } from "../presentation/TextViews";
import { MainMenuView } from "../presentation/MainMenuView";

import { InteractionSoundController } from "../presentation/InteractionSoundController";



import { WebXRHandStyle } from "./WebXRHandStyle";
import { worldMarkerHover } from "@dimos-ar-client/presentation/WorldPresentation";

/** Platform input depends on commands and the facts it presents, never the composition root. */
export interface WebXRInputPorts {
  manipulation: Pick<WebXRManipulationController, "owns" | "action" | "begin" | "beginPanel" | "hold"> & {
    interaction: Pick<WebXRManipulationController["interaction"], "dragging" | "retainingFeedback" | "setSpeedScale" | "speedScale">;
    renderer: Pick<WebXRManipulationController["renderer"],
      "controlsView" | "eeHovered" | "handDragging" | "handle" |
      "hoveredAction" | "hoveredLink" | "panel" | "pinned">;
  };
  navigation: Pick<WebXRNavigationController, "clearAim" | "cancelDrag" | "isDragging"> & {
    interaction: Pick<WebXRNavigationController["interaction"], "ownsDraft" | "snapshot">;
    marker: Pick<WebXRNavigationController["marker"], "cancelObject" | "object" | "setHovered" | "update">;
  };
  robot: Pick<WebXRRobotPresenter, "object" | "collider" | "markerCollider" | "floorWorldY" | "ownsTarget" | "setHovered">;
  ui: Pick<WebXRUIPresenter,
    "snapshot" | "setupCompleted" | "alignmentReview" | "menuOpen" | "debugEnabled" |
    "surfaceCount" | "nextSetup" | "previousSetup" | "retryConnection" | "toggleMenu" |
    "setOperatingMode" | "setLidarMode" | "adjustLidarRange" | "adjustLidarPoints" |
    "dismissAlignmentReview" | "restartLocalization">;
  speech: Pick<AgentDraftSession, "snapshot" | "beginRecording" | "setDraft" | "submitTyped">;
  originStore: { readonly hasTrackingOrigin: boolean };
  session: { view(): { capabilities: { navigation: { available: boolean } } | null } };
  joystick: { loseInput(): void };
  restartSetup(): void;
  realign(): void;
  cameraPreview(): CameraPreviewFrame | null;
  controlsEnabled(): boolean;
  isRobotSelected(): boolean;
  toggleRobotSelection(): void;
  holdNavigation(from: Vec3, direction: Vec3, planes: readonly FloorPlane[], fromMarker?: boolean, sourceId?: string): void;
  releaseNavigation(from: Vec3, direction: Vec3, planes: readonly FloorPlane[], sourceId?: string): void;
  aimNavigation(from: Vec3, direction: Vec3, planes: readonly FloorPlane[], sourceId?: string): void;
  loseInput(completeDictation?: boolean): void;
  emergencyStop(): void;
  cancelNavigation(): void;
}

type InputSource = xb.SelectEvent["target"];
type PrimaryGesture =
  | { kind: "navigation"; source: InputSource; fromMarker: boolean }
  | { kind: "arm"; source: InputSource }
  | { kind: "armPanel"; source: InputSource; grip: boolean }
  | { kind: "panel"; source: InputSource; grip: boolean }
  | { kind: "slider"; source: InputSource; object: THREE.Object3D; drag: xb.FreestandingSlider }
  | { kind: "scroll"; source: InputSource; view: ScrollableTextView; startY: number; offset: number; bar: boolean }
  | { kind: "ui"; source: InputSource };

export type InputEndReason = "release" | "cancelled" | "source-lost" | "tracking-lost" | "mode-change" | "suspend" | "stop" | "dispose";
type TouchContact = { object: THREE.Mesh; point: THREE.Vector3; distance: number };

/** One semantic owner; SDK ray/direct captures are mechanisms retired by its lifecycle. */
export class WebXRInputSession {
  private primary: PrimaryGesture | null = null;
  get worldHold() { return this.primary?.kind === "navigation" ? this.primary.source : null; }
  get holdFromMarker() { return this.primary?.kind === "navigation" && this.primary.fromMarker; }
  get panelHold() { return this.primary?.kind === "panel" ? this.primary.source : null; }
  get panelGrip() { return this.primary?.kind === "panel" && this.primary.grip; }
  get manipulationHold() { return this.primary?.kind === "arm" || this.primary?.kind === "armPanel" ? this.primary.source : null; }
  get robotPanelGrip() { return this.primary?.kind === "armPanel" && this.primary.grip; }
  get speedHold() { return this.primary?.kind === "slider" ? this.primary.object : null; }
  get speedDrag() { return this.primary?.kind === "slider" ? this.primary.drag : null; }
  get scrollHold() { return this.primary?.kind === "scroll" ? this.primary : null; }
  get uiGrab() { return !!this.primary && ["ui", "slider", "scroll", "panel"].includes(this.primary.kind); }
  private secondaryPressed = false;
  private readonly pressEdges = new ManipulationPressEdges();
  private readonly manipulationCapture = new ManipulationInputCapture();
  private readonly gripperPresses = new Set<xb.SelectEvent["target"]>();
  private readonly physicalPinches = new Set<InputSource>();
  private readonly capture = new InteractionCapture<InputSource>();
  private readonly touches: FingertipButtons<InputSource>;
  private cancellationReason: InputEndReason | null = null;
  constructor(dispatch: (source: InputSource, contact: TouchContact, start: boolean, cancelled: boolean) => void) {
    this.touches = new FingertipButtons({
      start: (source, contact) => dispatch(source, contact, true, false),
      end: (source, contact, cancelled) => dispatch(source, contact, false, cancelled),
    });
  }
  get owner(): InputSource | null { return this.capture.owner; }
  get endReason(): InputEndReason | null { return this.cancellationReason; }
  begin(gesture: PrimaryGesture): boolean {
    if (this.capture.owner !== gesture.source) return false;
    this.primary = gesture;
    return true;
  }
  cancelNavigation(): void {
    if (this.primary?.kind !== "navigation") return;
    this.primary = null;
    this.capture.cancel();
  }
  authorize(source: InputSource, object: object | undefined): boolean { return this.capture.press(source, object); }
  activate(id: number, target: object): boolean { return this.capture.activate(id, target); }
  retireAuthorization(): void { this.capture.cancel(); }
  observePress(sourceId: string, pressed: boolean): boolean { return this.pressEdges.observe(sourceId, pressed); }
  observeSecondaryPress(pressed: boolean): boolean {
    const rising = pressed && !this.secondaryPressed;
    this.secondaryPressed = pressed;
    return rising;
  }
  beginArmCapture(sourceId: string): void { this.manipulationCapture.begin(sourceId); }
  pressGripper(source: InputSource, sourceId: string): boolean {
    if (!this.manipulationCapture.pressGripper(sourceId)) return false;
    this.gripperPresses.add(source);
    return true;
  }
  releaseGripper(source: InputSource, sourceId: string): boolean {
    if (!this.gripperPresses.delete(source)) return false;
    this.manipulationCapture.release(sourceId);
    return true;
  }
  physicalPinch(source: InputSource, pressed: boolean): void {
    if (pressed) this.physicalPinches.add(source);
    else this.physicalPinches.delete(source);
  }
  ownsTouch(source: InputSource): boolean { return this.touches.owns(source); }
  releaseTouch(source: InputSource): void { this.touches.release(source); }
  sampleTouch(source: InputSource, tip: THREE.Vector3 | null, targets: THREE.Mesh[], eligible: (object: THREE.Object3D, point: THREE.Vector3) => boolean): void {
    this.touches.update(source, tip, targets, eligible, this.physicalPinches.has(source));
  }
  finish(reason: InputEndReason, adapters: { releaseMechanisms(): void; notifyDomain(complete: boolean): void }): void {
    this.physicalPinches.clear();
    this.gripperPresses.clear();
    this.manipulationCapture.reset();
    this.primary = null;
    this.secondaryPressed = false;
    adapters.releaseMechanisms();
    if (reason === "release" && this.capture.owner) this.capture.release(this.capture.owner);
    else this.capture.cancel();
    if (reason !== "suspend") adapters.notifyDomain(reason === "release");
  }
  cancelTouches(reason: InputEndReason): void {
    this.cancellationReason = reason;
    try { this.touches.cancel(); }
    finally { this.cancellationReason = null; }
  }
}

/** Panel placement and summoning have no robot gesture lifecycle state. */
export class PanelInputPresenter {
  private menuWasPressed = false;
  private reviewWasVisible = false;
  private setupWasVisible = false;
  readonly setupPlacement = new ViewerPanelPlacement();
  private menuWasVisible = false;
  private readonly palmGates = new Map<XRHandedness, PalmMenuGate>();
  readonly menuAnchor = new MenuAnchorController();
  private palmOpened = false;
  private session: XRSession | null = null;
  constructor(private readonly ui: WebXRInputPorts["ui"], private readonly menu: () => MainMenuView | null,
    private readonly holdingPanel: () => boolean, private readonly captured: () => boolean) {}
  detachAnchor(): void { this.menuAnchor.detach(); this.palmOpened = false; }
  inputSourcesChanged(session: XRSession | null): void {
    this.session = session;
    for (const [handedness, gate] of this.palmGates) {
      if (!Array.from(session?.inputSources ?? []).some(source => source.hand && source.handedness === handedness)) gate.reset();
    }
    if (this.menuAnchor.source && !Array.from(session?.inputSources ?? []).includes(this.menuAnchor.source)) {
      this.menuAnchor.detach();
      this.palmOpened = false;
    }
  }
  reset(): void {
    this.reviewWasVisible = this.setupWasVisible = this.menuWasVisible = false;
    for (const gate of this.palmGates.values()) gate.reset();
    this.menuAnchor.detach();
    this.palmOpened = false;
  }
  update(session: XRSession, frame: XRFrame, reference: XRReferenceSpace, p: DOMPointReadOnly, q: DOMPointReadOnly, deltaS: number) {
    this.session = session;
    const summoner = Array.from(this.session.inputSources).find(source => source.gamepad && isMenuButtonPressed(source.gamepad.buttons));
    const menu = Boolean(summoner);
    if (menu && !this.menuWasPressed) {
      this.ui.toggleMenu();
      if (this.ui.menuOpen && summoner) this.anchorMenu(summoner, frame, reference, p, q);
      else this.menuAnchor.detach();
      this.palmOpened = false;
    }
    this.menuWasPressed = menu;
    this.syncPalm(frame, reference, p, q);
    const snap = this.ui.snapshot();
    const reviewVisible = snap.alignmentReview?.pending === true;
    const setupVisible = !snap.setupCompleted || snap.setupCelebrating === true || reviewVisible;
    const setupOpening = setupVisible && (!this.setupWasVisible || reviewVisible !== this.reviewWasVisible);
    this.reviewWasVisible = reviewVisible;
    const visible = snap.menuOpen || setupVisible;
    if (setupVisible && this.menu()) {
      this.menuAnchor.detach();
      if (setupOpening) this.setupPlacement.begin();
      if (!this.holdingPanel()) this.setupPlacement.update(this.menu()!.panel, new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(q.x, q.y, q.z, q.w), deltaS, setupOpening);
    } else {
      if (visible && !this.menuWasVisible && !this.menuAnchor.source) this.placeMenuInFront(p, q);
      if (visible && this.menuAnchor.source && !this.holdingPanel()) {
        const position = this.anchorPosition(this.menuAnchor.source, frame, reference);
        if (position && this.menu()) this.menuAnchor.update(position, new THREE.Vector3(p.x, p.y, p.z), this.menu()!.panel, deltaS);
      }
    }
    this.setupWasVisible = setupVisible;
    if (!visible) this.menuAnchor.detach();
    if (visible && !this.menuWasVisible) {
      reportDiagnostic("panel-visible", {
        position: this.menu()?.panel.position.toArray(),
        input: Array.from(this.session.inputSources).map(source => ({ handedness: source.handedness, hand: Boolean(source.hand), controller: Boolean(source.gamepad) })),
      });
    }
    this.menuWasVisible = visible;
    return snap;
  }
  private placeMenuInFront(p: DOMPointReadOnly, q: DOMPointReadOnly, alpha = 1): void {
    const panel = this.menu()?.panel;
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
    if (!position || !this.menu()) return;
    this.menuAnchor.attach(source, position, new THREE.Vector3(eye.x, eye.y, eye.z), new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), this.menu()!.panel);
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
      if (!this.ui.setupCompleted || this.ui.alignmentReview?.pending) continue;
      if (changed && gate.isOpen && !this.ui.menuOpen) {
        this.ui.menuOpen = true;
        this.anchorMenu(source, frame, reference, eye, rotation);
        this.palmOpened = true;
      } else if (!gate.isOpen && this.palmOpened && this.menuAnchor.source === source && !this.captured()) {
        this.ui.menuOpen = false;
        this.menuAnchor.detach();
        this.palmOpened = false;
      }
    }
  }

}

export class WebXRInputController {
  readonly panels: PanelInputPresenter;
  readonly sound = new InteractionSoundController();
  private disposed = false;
  private mainMenu: MainMenuView | null = null;
  readonly gestures = new WebXRInputSession((source, contact, start, cancelled) => this.dispatchTouch(source, contact, start, cancelled));
  private detectedSurfaces: FloorPlane[] = [];
  private readonly placementBlocker = new THREE.Object3D();
  private touchDispatch = false;
  private readonly handStyle = new WebXRHandStyle();
  private readonly navigationFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  private interaction!: XRBlocksRayInteraction;
  private input!: xb.Input;
  private get session(): XRSession | null { return this.trackingState.session(); }
  private get tracking(): boolean { return this.trackingState.tracking(); }
  get menu(): MainMenuView | null { return this.mainMenu; }
  get rays(): XRBlocksRayInteraction { return this.interaction; }
  get floor(): THREE.Mesh { return this.navigationFloor; }
  get holdingWorld() { return this.gestures.worldHold; }
  get holdingPanel() { return this.gestures.panelHold; }
  get scrolling() { return this.gestures.scrollHold; }
  get anchor() { return this.panels.menuAnchor; }
  get setupPosition() { return this.panels.setupPlacement; }
  get grippingPanel(): boolean { return this.gestures.panelGrip; }

  constructor(private readonly client: WebXRInputPorts,
    private readonly scene: Pick<THREE.Object3D, "add">,
    private readonly trackingState: { session(): XRSession | null; tracking(): boolean }) {
    this.panels = new PanelInputPresenter(client.ui, () => this.mainMenu, () => this.gestures.panelHold !== null, () => this.gestures.owner !== null);
  }

  setEnabled(enabled: boolean): void { this.interaction?.setEnabled(enabled); }

  inputSourcesChanged(): void {
    this.clearInput("source-lost");
    this.panels.inputSourcesChanged(this.session);
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
        hits: surfaces, fallbackY: floorY });
      const point = new THREE.Vector3(...result.probePosition);
      const distance = point.distanceTo(raycaster.ray.origin);
      if (distance > FLOOR_AIM_RANGE_M || distance > raycaster.far || distance < raycaster.near) return;
      hits.push({ point, distance, object: result.status === "ok" ? this.navigationFloor : this.placementBlocker });
    };
    registerRayTarget(this.navigationFloor);
    markRayAmbient(this.navigationFloor);
    this.scene.add(this.navigationFloor);
    this.mainMenu = new MainMenuView({
      canActivate: (id, target) => (this.touchDispatch || !this.input.controllers.some(source => source.userData.id === id && this.gestures.ownsTouch(source))) && this.gestures.activate(id, target),
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
      ignored: (controller, object) => this.client.robot.ownsTarget(object) && this.client.navigation.interaction.ownsDraft(this.navigationSourceId(controller)),
      captured: controller => this.gestures.owner === controller && (this.gestures.uiGrab || this.gestures.worldHold === controller || this.gestures.manipulationHold === controller || this.gestures.panelHold === controller),
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
    const snap = this.panels.update(this.session, frame, reference, p, q, deltaS);
    this.mainMenu?.apply(snap, this.client.speech.snapshot());
    this.mainMenu?.updateCameraPreview(this.client.cameraPreview(), deltaS);
    this.navigationFloor.visible = this.client.controlsEnabled() && this.client.session.view().capabilities?.navigation.available === true && this.client.robot.floorWorldY() !== null;
    this.navigationFloor.position.y = this.client.robot.floorWorldY() ?? 0;
    if (!this.client.controlsEnabled()) {
      this.gestures.cancelNavigation();
      this.client.navigation.cancelDrag();
      this.client.joystick.loseInput();
    }
    this.detectedSurfaces = this.readDetectedSurfaces(frame, reference);
    this.client.ui.surfaceCount = this.detectedSurfaces.length;
    if (this.gestures.manipulationHold && !this.client.manipulation.interaction.dragging && !this.client.manipulation.renderer.pinned) this.clearInput("mode-change");
    if (this.gestures.owner && (!this.gestures.owner.visible || this.gestures.owner.userData.connected !== true)) this.clearInput("source-lost");
    this.handStyle.apply(this.input.hands);
    this.interaction.direct.sample(frame, reference, this.input.controllers);
    if (this.interaction.direct.hasLostCapture()) this.clearInput("tracking-lost");
    for (const controller of this.input.controllers) {
      this.input.setRaycasterFromController(controller);
      this.input.performRaycastOnScene(controller);
    }
    this.interaction.update(deltaS);
    const hits = this.input.controllers.map(controller => this.interaction.hit(controller)?.object);
    this.client.navigation.marker.update(new THREE.Vector3(p.x, p.y, p.z), hits.includes(this.client.navigation.marker.cancelObject));
    this.client.manipulation.renderer.controlsView.onRecalibrate ??= () => this.client.realign();
    this.mainMenu?.updateHover(hits, deltaS);
    this.client.manipulation.renderer.controlsView.frame.updateHover(hits, deltaS);
    const actionableHits = this.input.controllers.map(controller => {
      const hit = this.interaction.hit(controller);
      return hit && this.canInteract(controller, hit.object, hit.point) ? hit.object : undefined;
    });
    const hoverTargets = this.interaction.hoverTargets(this.client.robot.collider);
    const manipulationHovered = actionableHits.find(hit => hit && this.client.manipulation.owns(hit));
    this.client.manipulation.renderer.hoveredLink = manipulationHovered?.userData.manipulationLink ?? null;
    this.client.manipulation.renderer.hoveredAction = manipulationHovered?.userData.manipulationAction ?? null;
    this.client.manipulation.renderer.handDragging = !!this.gestures.manipulationHold?.inputSource?.hand && this.client.manipulation.interaction.dragging;
    this.client.manipulation.renderer.eeHovered = actionableHits.some(hit => !!hit && (hit === this.client.manipulation.renderer.handle.collider || hit.userData.endEffectorAction === true));
    const robotHovered = hoverTargets.some(hit => this.client.robot.ownsTarget(hit)) ||
      this.interaction.hoverTargets(this.client.robot.markerCollider).includes(this.client.robot.markerCollider);
    const markerHovered = hoverTargets.some(hit => hit !== this.client.navigation.marker.cancelObject && isDescendant(hit, this.client.navigation.marker.object));
    const worldHover = worldMarkerHover(this.client.navigation.interaction.snapshot().attachedToRobot, robotHovered, markerHovered);
    this.client.robot.setHovered(worldHover.robot);
    this.sound.setActive(true);
    this.sound.setSuppressed(["Starting microphone…", "Listening", "Transcribing…", "Responding"].includes(this.client.speech.snapshot().status));
    const hovered = manipulationHovered ?? (robotHovered ? this.client.robot.object : actionableHits.some(hit => !!hit && hit !== this.client.navigation.marker.cancelObject && isDescendant(hit, this.client.navigation.marker.object)) ? this.client.navigation.marker.object : null);
    this.sound.update(hovered ?? null, this.client.isRobotSelected(), this.client.navigation.isDragging() || !!this.gestures.worldHold || !!this.gestures.manipulationHold,
      this.client.navigation.marker.object.position, time / 1000);
    this.client.navigation.marker.setHovered(worldHover.marker);
    const connectedSources = new Set<string>();
    for (const pointer of this.input.controllers) {
      const sourceId = this.navigationSourceId(pointer);
      if (!pointer.visible || pointer.userData.connected !== true) { this.client.navigation.clearAim(sourceId); continue; }
      connectedSources.add(sourceId);
      if (this.gestures.worldHold === pointer || this.gestures.uiGrab && this.gestures.owner === pointer) continue;
      const target = this.interaction.hit(pointer)?.object;
      if (target === this.navigationFloor) {
        const ray = this.interaction.smoothedRay(pointer);
        this.client.aimNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), sourceId);
      } else this.client.navigation.clearAim(sourceId);
    }
    const placement = this.client.navigation.interaction.snapshot();
    for (const probe of placement.probes) if (!connectedSources.has(probe.sourceId)) this.client.navigation.clearAim(probe.sourceId);
    if (placement.draft && !connectedSources.has(placement.draft.ownerId)) this.client.navigation.clearAim(placement.draft.ownerId);
    if (this.gestures.scrollHold && this.gestures.owner) {
      const ray = this.gestureRay(this.gestures.owner);
      const y = this.scrollPointerY(this.gestures.scrollHold.view, ray.origin, ray.direction);
      if (y !== null) {
        const { view, startY, offset, bar } = this.gestures.scrollHold;
        view.scrollTo(offset + (y - startY) * (bar ? -view.maxScroll / view.rangeY : 1));
      }
    } else if (!this.gestures.uiGrab) {
      const pointer = preferredPointer(this.input.controllers);
      const view = pointer ? this.mainMenu?.scrollView(this.interaction.hit(pointer)?.object) : null;
      const axes = pointer?.inputSource?.gamepad?.axes;
      const axis = axes ? axes[axes.length >= 4 ? 3 : 1] ?? 0 : 0;
      if (view && Math.abs(axis) > 0.2) view.scrollBy(axis * deltaS * view.rangeY * 3);
    }
    if (this.gestures.panelHold) {
      const ray = this.panelRay(this.gestures.panelHold);
      this.mainMenu?.updateManipulation(ray.origin, ray.direction, this.gestures.panelHold.getWorldQuaternion(new THREE.Quaternion()), deltaS, new THREE.Vector3(p.x, p.y, p.z));
    }
    if (this.gestures.speedHold && this.gestures.owner) {
      const ray = this.gestureRay(this.gestures.owner);
      this.gestures.speedHold.updateWorldMatrix(true, false);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.gestures.speedHold.matrixWorld);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.gestures.speedHold.getWorldPosition(new THREE.Vector3()));
      const point = new THREE.Ray(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.direction)).intersectPlane(plane, new THREE.Vector3());
      if (point) { const half = this.gestures.speedHold.userData.sliderHalfWidth as number; this.client.manipulation.interaction.setSpeedScale(0.05 + THREE.MathUtils.clamp((this.gestures.speedHold.worldToLocal(point).x + half) / (2 * half), 0, 1) * 0.95); } else if(this.gestures.speedDrag) this.client.manipulation.interaction.setSpeedScale(this.gestures.speedDrag.getValue(this.gestures.owner.getWorldPosition(new THREE.Vector3())));
    }
    if (this.gestures.manipulationHold) {
      const source = this.gestures.manipulationHold;
      if (!source.visible || source.userData.connected !== true || (!this.client.controlsEnabled() && !this.client.manipulation.interaction.retainingFeedback)) this.clearInput();
      else {
        const pressed = source.inputSource?.gamepad?.buttons[1]?.pressed === true;
        if (this.gestures.observeSecondaryPress(pressed) && this.client.manipulation.interaction.dragging && !this.gestures.robotPanelGrip) this.client.manipulation.action("gripper");
        this.client.manipulation.hold(source.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], source.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number], this.gestureRay(source));
      }
    }
    if (this.gestures.worldHold && !this.gestures.uiGrab) {
      const ray = this.gestureRay(this.gestures.worldHold);
      this.client.holdNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), this.gestures.holdFromMarker, this.navigationSourceId(this.gestures.worldHold));
    }
    this.interaction.updateCapturedEndpoints();
    const touchTargets: THREE.Mesh[] = [];
    this.mainMenu?.panel.traverse(object => { if (object instanceof THREE.Mesh && object.userData.touchButton) touchTargets.push(object); });
    for (const source of this.input.controllers) {
      const tip = source.visible && source.userData.connected === true ? this.interaction.direct.indexTip(source) : null;
      if (!this.gestures.ownsTouch(source) && source.userData.selected === true) continue;
      this.gestures.sampleTouch(source, tip, touchTargets, (object, point) => this.canInteract(source, object, point));
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
    const secondaryGripper = this.gestures.manipulationHold && this.gestures.manipulationHold !== controller && !!controller.inputSource?.hand && object.userData.manipulationAction === "gripper";
    if (this.gestures.owner && this.gestures.owner !== controller && !secondaryGripper && !["estop", "stop"].includes(object.userData.manipulationAction) && !this.mainMenu?.isEmergencyTarget(object) && !(object === this.navigationFloor && this.client.isRobotSelected())) return false;
    if (this.mainMenu?.ownsTarget(object)) return this.mainMenu.canInteract(object, point);
    if (object !== this.navigationFloor) {
      const origin = controller.getWorldPosition(new THREE.Vector3());
      const direction = point.clone().sub(origin).normalize();
      const surface = navigationSurfaceHits(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], this.detectedSurfaces, this.client.robot.floorWorldY() ?? 0)[0];
      if (surface && new THREE.Vector3(...surface.position).distanceTo(origin) + 0.02 < point.distanceTo(origin)) return false;
    }
    if (this.client.robot.ownsTarget(object) && this.client.navigation.interaction.ownsDraft(this.navigationSourceId(controller))) return false;
    if (this.client.robot.ownsTarget(object)) return this.client.ui.snapshot().robotSelectable;
    if (!this.client.controlsEnabled() || !this.client.originStore.hasTrackingOrigin) return false;
    if (object === this.navigationFloor) return this.client.isRobotSelected() && point.distanceTo(controller.getWorldPosition(new THREE.Vector3())) <= FLOOR_AIM_RANGE_M;
    if (this.client.manipulation.owns(object)) return object.userData.interactionEnabled !== false;
    return isDescendant(object, this.client.navigation.marker.object) && object.userData.rayDisabled !== true;
  }

  onSelectStart(event: xb.SelectEvent): void {
    if (!this.touchDispatch && event.target.inputSource?.hand) this.gestures.physicalPinch(event.target, true);
    if (!this.touchDispatch && this.gestures.ownsTouch(event.target)) return;
    if (!this.tracking || this.session?.visibilityState !== "visible") return;
    if (!this.gestures.observePress(this.navigationSourceId(event.target), true)) return;
    const hit = this.interaction.hit(event.target);
    if (this.mainMenu?.isEmergencyTarget(hit?.object) || hit?.object.userData.manipulationAction === "estop") {
      this.clearInput("stop");
      this.client.emergencyStop();
      return;
    }
    if (!hit || !this.canInteract(event.target, hit.object, hit.point)) return;
    if (hit.object.userData.manipulationAction === "stop") {
      this.clearInput("stop");
      this.client.manipulation.action("stop");
      return;
    }
    if (hit.object.userData.manipulationAction === "gripper" && this.gestures.manipulationHold &&
        this.gestures.manipulationHold !== event.target && event.target.inputSource?.hand) {
      if (this.gestures.pressGripper(event.target, this.navigationSourceId(event.target))) {
        this.client.manipulation.action("gripper");
      }
      return;
    }
    if (!this.gestures.authorize(event.target, hit?.object)) return;
    if (hit.object !== this.navigationFloor && hit.object !== this.placementBlocker) this.interaction.capture(event.target, hit.object, hit.point);
    this.interaction.direct.capture(event.target, hit.object,
      isDescendant(hit.object, this.client.navigation.marker.object) ? new THREE.Vector3(0, 1, 0) : undefined);
    if (this.gestures.panelHold || this.gestures.worldHold || this.gestures.manipulationHold || this.gestures.uiGrab) return;
    if (hit.object.userData.manipulationSpeedSlider) {
      const thumb = hit.object.userData.sliderThumb as THREE.Object3D | undefined;
      if (thumb) this.interaction.capture(event.target, thumb, thumb.getWorldPosition(new THREE.Vector3()));
      const half=hit.object.userData.sliderHalfWidth as number;
      const start=.05+THREE.MathUtils.clamp((hit.object.worldToLocal(hit.point.clone()).x+half)/(2*half),0,1)*.95;
      this.client.manipulation.interaction.setSpeedScale(start);
      const width=2*half*hit.object.getWorldScale(new THREE.Vector3()).x;
      const drag = new xb.FreestandingSlider(start,.05,1,.95/width);
      drag.setInitialPose(event.target.getWorldPosition(new THREE.Vector3()),hit.object.getWorldQuaternion(new THREE.Quaternion()));
      this.gestures.begin({ kind: "slider", source: event.target, object: hit.object, drag });
      return;
    }
    if (hit.object.userData.manipulationPanel) {
      this.client.manipulation.beginPanel(event.target.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], event.target.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number], hit.object.userData.panelHandle ?? "bar", this.gestureRay(event.target));
      this.gestures.begin({ kind: "armPanel", source: event.target, grip: false }); return;
    }
    if (this.client.manipulation.owns(hit.object) && this.client.controlsEnabled()) {
      const action = hit.object.userData.manipulationAction;
      if (action) { this.client.manipulation.action(action); this.gestures.begin({ kind: "ui", source: event.target }); }
      else if (hit.object.userData.manipulationLink) { this.client.toggleRobotSelection(); this.gestures.begin({ kind: "ui", source: event.target }); }
      else if (this.client.manipulation.begin(event.target.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number], event.target.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number, number, number, number])) { this.gestures.begin({ kind: "arm", source: event.target }); this.gestures.beginArmCapture(this.navigationSourceId(event.target)); }
      return;
    }
    const ray = this.mainMenu?.ownsTarget(hit.object) ? this.panelRay(event.target) : this.gestureRay(event.target);
    reportDiagnostic("ray-select", { hand: event.target.inputSource?.handedness, surface: hit?.object.name, distanceM: hit?.distance });
    if (this.mainMenu?.ownsTarget(hit?.object)) {
      this.gestures.begin({ kind: "ui", source: event.target });
      this.client.navigation.clearAim(this.navigationSourceId(event.target));
      this.client.joystick.loseInput();
      const scroll = this.mainMenu.scrollView(hit?.object);
      if (scroll && (hit?.object.userData.scrollbar || hit?.object.userData.bodyScrollable)) {
        const y = this.scrollPointerY(scroll, ray.origin, ray.direction);
        if (y !== null) this.gestures.begin({ kind: "scroll", source: event.target, view: scroll, startY: y, offset: scroll.scrollOffset, bar: hit.object.userData.scrollbar === true });
        return;
      }
      if (this.mainMenu.isSpeechTarget(hit?.object)) this.client.speech.beginRecording();
      if (!this.mainMenu.isControl(hit?.object) && this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()))) {
        this.panels.setupPlacement.pin();
        this.gestures.begin({ kind: "panel", source: event.target, grip: false });
        this.panels.detachAnchor();
      }
      return;
    }
    if (hit?.object === this.client.navigation.marker.cancelObject) {
      this.client.cancelNavigation();
      this.gestures.begin({ kind: "ui", source: event.target });
      return;
    }
    if (hit && this.client.robot.ownsTarget(hit.object) && this.client.ui.setupCompleted) {
      this.client.toggleRobotSelection();
      this.gestures.begin({ kind: "ui", source: event.target });
      return;
    }
    if (!this.client.controlsEnabled() || !hit || hit.object === this.placementBlocker) return;
    const fromMarker = isDescendant(hit.object, this.client.navigation.marker.object);
    if (!fromMarker && (hit.object !== this.navigationFloor || !this.client.isRobotSelected())) return;
    this.gestures.begin({ kind: "navigation", source: event.target, fromMarker });
    const smoothed = this.gestureRay(event.target);
    this.client.holdNavigation(smoothed.origin, smoothed.direction, this.navigationFloorPlanes(), this.gestures.holdFromMarker, this.navigationSourceId(event.target));
  }

  onSqueezeStart(event: xb.SelectEvent): void {
    if (!this.tracking || this.gestures.panelHold || this.gestures.manipulationHold || this.gestures.worldHold || this.gestures.uiGrab || this.session?.visibilityState !== "visible") return;
    const armContact = this.interaction.hit(event.target);
    if (armContact && isDescendant(armContact.object,this.client.manipulation.renderer.panel)) {
      this.clearInput();
      this.client.manipulation.beginPanel(event.target.getWorldPosition(new THREE.Vector3()).toArray() as [number,number,number],event.target.getWorldQuaternion(new THREE.Quaternion()).toArray() as [number,number,number,number],"body",this.gestureRay(event.target));
      this.gestures.authorize(event.target,armContact.object);
      this.gestures.begin({ kind: "armPanel", source: event.target, grip: true }); return;
    }
    if (!this.mainMenu?.ownsTarget(this.interaction.hit(event.target)?.object)) return;
    const ray = this.panelRay(event.target);
    this.clearInput();
    if (!this.mainMenu.beginManipulation(ray.origin, ray.direction, event.target.getWorldQuaternion(new THREE.Quaternion()), true)) return;
    this.gestures.authorize(event.target, this.interaction.hit(event.target)?.object);
    const contact = this.interaction.hit(event.target);
    if (contact) this.interaction.capture(event.target, contact.object, contact.point);
    this.interaction.direct.capture(event.target, this.interaction.hit(event.target)!.object);
    this.panels.setupPlacement.pin();
    this.gestures.begin({ kind: "panel", source: event.target, grip: true });
    this.panels.detachAnchor();
  }

  onSqueezeEnd(event: xb.SelectEvent): void {
    if ((this.gestures.panelGrip && this.gestures.panelHold === event.target) || (this.gestures.robotPanelGrip && this.gestures.manipulationHold === event.target)) this.clearInput();
  }

  onSelectEnd(event: xb.SelectEvent): void {
    if (!this.touchDispatch) this.gestures.physicalPinch(event.target, false);
    this.gestures.observePress(this.navigationSourceId(event.target), false);
    if (this.gestures.releaseGripper(event.target, this.navigationSourceId(event.target))) {
      return;
    }
    if (!this.touchDispatch && this.gestures.ownsTouch(event.target)) { this.gestures.releaseTouch(event.target); return; }
    if (this.gestures.owner && this.gestures.owner !== event.target) return;
    if (this.gestures.panelGrip || (this.gestures.panelHold && this.gestures.panelHold !== event.target) ||
        (this.gestures.worldHold && this.gestures.worldHold !== event.target)) return;
    if (this.gestures.worldHold === event.target && !this.gestures.uiGrab && this.client.controlsEnabled()) {
      const ray = this.gestureRay(event.target);
      this.client.releaseNavigation(ray.origin, ray.direction, this.navigationFloorPlanes(), this.navigationSourceId(event.target));
      this.sound.play("confirm");
    }
    this.clearInput("release");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gestures.cancelTouches("dispose");
    this.clearInput("dispose");
    this.sound.dispose();
    this.interaction?.dispose();
    this.handStyle.dispose();
    this.navigationFloor.geometry.dispose();
    this.navigationFloor.material.dispose();
    this.mainMenu?.dispose();
    this.mainMenu?.panel.removeFromParent();
  }

  private dispatchTouch(source: xb.SelectEvent["target"], contact: { object: THREE.Mesh; point: THREE.Vector3; distance: number }, start: boolean, cancelled: boolean): void {
    if (contact.object.userData.manipulationAction === "gripper" && source.inputSource?.hand &&
        this.gestures.manipulationHold && this.gestures.manipulationHold !== source) {
      const id = this.navigationSourceId(source);
      if (start && !cancelled && this.client.controlsEnabled() && this.gestures.pressGripper(source, id)) {
        this.client.manipulation.action("gripper");
      } else if (!start) { this.gestures.releaseGripper(source, id); }
      return;
    }
    this.touchDispatch = true;
    try {
      const event: { type: "selectstart" | "selectend"; target: xb.SelectEvent["target"] } = { type: start ? "selectstart" : "selectend", target: source };
      if (start) this.input.defaultOnSelectStart(event);
      else this.input.defaultOnSelectEnd(event);
      if (cancelled) this.gestures.retireAuthorization();
      this.input.intersectionsForController.set(source, [contact]);
      if (start) { xb.core.user.onSelectStart(event); this.onSelectStart(event); }
      else {
        // A physical pinch release may already have retired the SDK's selection.
        // Re-register the captured button, preserving the original activation guard.
        const pressEvent = { ...event, type: "selectstart" as const };
        xb.core.user.onSelectStart(pressEvent);
        xb.core.user.onSelectEnd(event);
        if (cancelled) this.clearInput(this.gestures.endReason ?? "cancelled"); else this.onSelectEnd(event);
      }
    } finally { this.touchDispatch = false; }
  }

  private panelRay(controller: xb.SelectEvent["target"]): { origin: [number, number, number]; direction: [number, number, number] } {
    return this.interaction.direct.ray(controller) ?? this.interaction.ray(controller);
  }

  private gestureRay(controller: xb.SelectEvent["target"]): { origin: [number, number, number]; direction: [number, number, number] } {
    return this.interaction.direct.ray(controller) ?? this.interaction.smoothedRay(controller);
  }

  private clearInput(reason: InputEndReason = "cancelled"): void {
    this.gestures.finish(reason, {
      releaseMechanisms: () => {
        this.interaction?.direct.cancel();
        this.interaction?.releaseCaptures();
        this.mainMenu?.endManipulation();
      },
      notifyDomain: complete => this.client.loseInput(complete),
    });
  }

  suspend(): void {
    this.gestures.cancelTouches("suspend");
    this.clearInput("suspend");
    this.client.robot.setHovered(false);
    this.client.navigation.marker.setHovered(false);
    this.sound.setActive(false);
    this.navigationFloor.visible = false;
    this.interaction?.setEnabled(false);
  }

  reset(): void {
    this.suspend();
    this.panels.reset();
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
    if (!axes || axes.length < 2 || this.gestures.uiGrab || this.gestures.panelHold || this.gestures.worldHold) return null;
    const pointer = this.input.controllers.find(controller => controller.inputSource === source);
    if (pointer && this.mainMenu?.scrollView(this.interaction.hit(pointer)?.object)) return null;
    return { x: axes.length >= 4 ? axes[2] : axes[0], y: axes.length >= 4 ? axes[3] : axes[1] };
  }


}

function isDescendant(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node === ancestor) return true;
  }
  return false;
}
