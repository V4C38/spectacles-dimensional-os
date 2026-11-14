import type { ReadonlyFacts } from "@dimos-ar-client/ClientContracts";
import { ARM_PANEL_STYLE, PanelHeightAnimation } from "@dimos-ar-client/presentation/ControlPanelPresentation";
import { RobotPanelFrame } from "../presentation/RobotPanelFrame";
import { manipulationMenuRows, manipulationButtonEnabled, endEffectorAction, type ManipulationSnapshot } from "@dimos-ar-client/manipulation/ManipulationPresentation";

import type {
  ManipulationGroup as MutableManipulationGroup,
  ManipulationObservation as MutableManipulationObservation,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import * as THREE from "three";
import { Text } from "troika-three-text";
import { registerRayTarget } from "../input/WebXRInteraction";
import { DIMOS_AR_DESIGN } from "../presentation/DimOSARDesign";
import { GlassSurface } from "../presentation/SurfaceMaterials";

import { indicatorMaterial } from "../presentation/PoseIndicatorMaterial";
import { RobotMarkerLabel } from "../presentation/RobotMarkerLabel";
import { SpeedSlider } from "../presentation/SpeedSlider";
import { SurfaceButton } from "../presentation/SurfaceButton";
import { syncText, UI_FONT_REGULAR, UI_FONT_SEMIBOLD, disposeObjectTrees } from "../presentation/SceneResources";

type ManipulationGroup = ReadonlyFacts<MutableManipulationGroup>;
type ManipulationObservation = ReadonlyFacts<MutableManipulationObservation>;


export class ManipulationControlsView {
  readonly controls = new THREE.Group();
  readonly baseMarker = new THREE.Group();
  readonly baseLabel = new RobotMarkerLabel();
  readonly gripperMenu = new THREE.Group();
  readonly previewMenu = new THREE.Group();
  readonly speedSlider = new SpeedSlider(0.14);
  readonly frame = new RobotPanelFrame(this.controls);
  readonly title = new Text();
  localizationAvailable = false;
  onRecalibrate: (() => void) | null = null;
  readonly buttons = new Map<string, SurfaceButton>();
  private readonly menuHeight = new PanelHeightAnimation();
  private readonly speedLabel = new Text();
  private readonly speedTitle = new Text();
  private readonly menuPlate: GlassSurface;
  private hoverUntil = 0;
  private hoverProgress = 0;
  constructor() {
    this.menuHeight.request(4 * ARM_PANEL_STYLE.rowM + ARM_PANEL_STYLE.paddingM + ARM_PANEL_STYLE.headerM, true);
    this.baseLabel.scale.setScalar(0.75);
    this.baseLabel.tagMessage.fillOpacity = 0.5;
    this.baseLabel.tagMessage.color = 0xffffff;
    const plate = new GlassSurface({
      width: 0.26,
      height: 0.13,
      radius: ARM_PANEL_STYLE.cornerM,
      tint: DIMOS_AR_DESIGN.colors.background,
      alpha: 0.98,
      rim: .28,
      rimWidth: 0.002,
    });
    this.menuPlate = plate;
    plate.userData.interactionEnabled = false;
    plate.userData.rayPriority = 15;
    registerRayTarget(plate);
    plate.renderOrder = 10;
    this.controls.add(plate);
    const headerHit = new THREE.Mesh(new THREE.PlaneGeometry(.13,.04),new THREE.MeshBasicMaterial({visible:false}));
    headerHit.position.set(-.035,-.024,.006); headerHit.userData.manipulationPanel=true;
    headerHit.userData.panelHandle="body"; registerRayTarget(headerHit); this.controls.add(headerHit);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.009, 20, 16),
      indicatorMaterial(),
    );
    orb.userData.manipulationLink = "base-marker";
    orb.userData.rayPriority = 5;
    registerRayTarget(orb);

    this.baseMarker.add(orb);
    this.baseLabel.position.set(0, 0.05, 0);
    this.baseMarker.add(this.baseLabel);
    const addButton = (
      key: string,
      parent: THREE.Group,
      text: string,
      action: string,
      x: number,
      y: number,
      width: number,
      variant: "default" | "primary" | "danger" = "default",
    ) => {
      const button = new SurfaceButton({
        text,
        font: UI_FONT_SEMIBOLD,
        width,
        height: ARM_PANEL_STYLE.buttonHeightM,
        fontSize: ARM_PANEL_STYLE.buttonFontM / ARM_PANEL_STYLE.buttonHeightM,
        opacity: 1,
        backgroundColor: DIMOS_AR_DESIGN.colors.control,
      });
      button.isRoot = true;
      button.renderOrder = 62;
      parent.add(button);
      button.updateLayouts();
      button.position.set(x, y, 0.008);
      if (key === "plan" || key === "execute") button.userData.fixedSurfaceDepth = DIMOS_AR_DESIGN.depth.secondary;
      button.setSurface(variant);
      button.traverse((node) => {
        node.userData.manipulationAction = action;
        if (key === "plan" || key === "execute") node.userData.endEffectorAction = true;
        node.renderOrder = node === button ? 62 : 63;
      });
      this.buttons.set(key, button);
      return button;
    };
    addButton("plan", this.previewMenu, "Preview", "plan", 0, 0.039, 0.095);
    addButton(
      "execute",
      this.previewMenu,
      "Execute",
      "execute",
      0,
      0,
      0.095,
      "primary",
    );
    addButton("estop", this.controls, "E-stop", "estop", 0, 0, 0.2, "danger");
    addButton("reset", this.controls, "Reset", "reset", 0, 0, 0.092);
    addButton("stop", this.controls, "Stop", "stop", 0, 0, 0.092);
    addButton("pin", this.controls, "", "pin", ARM_PANEL_STYLE.pinXM, ARM_PANEL_STYLE.pinYM, ARM_PANEL_STYLE.pinSizeM);
    const scan = addButton("recalibrate", this.controls, "", "recalibrate", ARM_PANEL_STYLE.pinXM - .039, ARM_PANEL_STYLE.pinYM, ARM_PANEL_STYLE.pinSizeM);
    scan.onTriggered = () => this.onRecalibrate?.();
    this.controls.add(this.frame.pinLines, this.frame.scanLines, this.title);
    this.title.font = UI_FONT_SEMIBOLD; this.title.fontSize = .013;
    this.title.anchorX = "left"; this.title.anchorY = "middle";
    this.title.position.set(-.096, ARM_PANEL_STYLE.pinYM, .014);
    this.title.maxWidth = .12; this.title.color = 0xffffff; this.title.renderOrder = 66;
    this.title.raycast = () => {};

    this.speedSlider.hit.userData.manipulationControl = true;
    this.controls.add(this.speedSlider);
    this.speedLabel.font = UI_FONT_REGULAR;
    this.speedLabel.fontSize = 0.011;
    this.speedLabel.anchorX = "right";
    this.speedLabel.anchorY = "bottom";
    this.speedLabel.color = 0xaeaeb2;
    this.speedLabel.renderOrder = 66;
    this.speedLabel.raycast = () => {};
    this.speedSlider.add(this.speedLabel);
    this.speedLabel.position.set(.07, .012, 0);
    this.speedTitle.font = UI_FONT_REGULAR; this.speedTitle.fontSize = .011;
    this.speedTitle.text = "Movement speed"; this.speedTitle.anchorX = "left"; this.speedTitle.anchorY = "bottom";
    this.speedTitle.color = 0xaeaeb2; this.speedTitle.renderOrder = 66; this.speedTitle.raycast = () => {};
    this.speedTitle.position.set(-.07, .012, 0); this.speedSlider.add(this.speedTitle); syncText(this.speedTitle);
    const eeAction = addButton("gripper", this.gripperMenu, "Open", "gripper", 0, 0, 0.095);
    eeAction.traverse(node => { node.userData.endEffectorAction = true; });
    this.baseMarker.add(this.controls);
    this.controls.scale.setScalar(ARM_PANEL_STYLE.defaultScale);
    this.controls.position.set(0, -0.13, 0);
    plate.visible = true;
    plate.userData.interactionEnabled = false;
  }
  apply(input: {
    intent: ManipulationSnapshot;
    handDragging?: boolean;
    selected: boolean;
    displaced: boolean;
    group: ManipulationGroup | undefined;
    observed: ManipulationObservation | null | undefined;
    speedScale: number;
    desiredGripper: number | null;
    previewRequested: boolean;
    hoveredAction: string | null;
    endEffectorHovered: boolean;
    handle: THREE.Object3D;
    now: number;
    delta: number;
  }): void {
    const {
      intent,
      selected,
      group,
      observed,
      handle,
      now,
      delta: dtOutline,
    } = input;
    const { dragging, stopped } = intent;
    const state = { stopped };
    this.controls.visible = true;
    this.speedSlider.setValue(input.speedScale);
    const speedText = `${Math.round(input.speedScale * 100)}%`;
    if (this.speedLabel.text !== speedText) {
      this.speedLabel.text = speedText;
      syncText(this.speedLabel);
    }
    this.speedSlider.hit.userData.interactionEnabled = intent.canManipulate;
    const rows = manipulationMenuRows();
    this.menuHeight.request((rows.length - 1) * ARM_PANEL_STYLE.rowM + ARM_PANEL_STYLE.paddingM + ARM_PANEL_STYLE.headerM);
    this.menuHeight.tick(dtOutline);
    this.menuPlate.resize(0.224, this.menuHeight.height, ARM_PANEL_STYLE.cornerM);
    this.menuPlate.position.y = -this.menuHeight.height / 2;
    this.frame.resize(this.menuHeight.height);
    const pin = this.buttons.get("pin")!;
    this.frame.pinLines.position.set(pin.position.x, pin.position.y,
      pin.position.z + DIMOS_AR_DESIGN.depth.labelOffset / Math.max(1e-6, this.controls.getWorldScale(new THREE.Vector3()).z));
    const scan = this.buttons.get("recalibrate")!;
    scan.visible = this.frame.scanLines.visible = this.localizationAvailable && !!this.onRecalibrate;
    scan.setEnabled(this.localizationAvailable && !!this.onRecalibrate && !intent.executing && !intent.dragging && !intent.resetting);
    this.frame.scanLines.position.set(scan.position.x, scan.position.y, this.frame.pinLines.position.z);
    const fullName = this.baseLabel.tagTitle.text;
    const name = fullName.length > 15 ? `${fullName.slice(0,14)}…` : fullName;
    if (this.title.text !== name) { this.title.text = name; syncText(this.title); }
    for (const key of ["reset", "stop", "estop"])
      this.buttons.get(key)!.visible = rows.includes(key);
    rows.forEach((key) => {
      const index = key === "reset" || key === "stop" ? 0 : key === "speed" ? 1 : 2;
      const control = key === "speed" ? this.speedSlider : this.buttons.get(key)!;
      control.position.set(key === "reset" ? .053 : key === "stop" ? -.053 : 0,
        -ARM_PANEL_STYLE.headerM - .028 - index * ARM_PANEL_STYLE.rowM - (key === "speed" ? .01 : index > 1 ? .012 : 0), .008);
    });
    const emergency = this.buttons.get("estop")!;
    const emergencyAction = state.stopped ? "resume" : "estop";
    if (emergency.userData.mode !== emergencyAction) {
      emergency.userData.mode = emergencyAction;
      emergency.setText(state.stopped ? "Resume operation" : "E-stop");
      emergency.setVariant(state.stopped ? "resume" : "danger");
      emergency.traverse((node) => {
        node.userData.manipulationAction = emergencyAction;
      });
    }
    const opening = selected ? input.desiredGripper ?? observed?.gripper_target ?? observed?.gripper : observed?.gripper_target ?? observed?.gripper;
    const markerAction = endEffectorAction(intent, opening, group?.has_gripper === true);
    for (const [key, button] of this.buttons) {
      button.setEnabled(key === "pin" || (key === "recalibrate" ? this.localizationAvailable && !!this.onRecalibrate && !intent.executing && !intent.dragging && !intent.resetting : manipulationButtonEnabled(key, intent)));
      if (key === "plan") {
        button.setActive(input.previewRequested);
        button.setEnabled(intent.canPreview);
      }
      if (key === "gripper") {
        button.visible = markerAction.available;
        button.setText(markerAction.label);
        button.setEnabled(markerAction.enabled);
        if (button.userData.mode !== markerAction.action) {
          button.userData.mode = markerAction.action;
          button.setVariant("default");
          button.traverse(node => { node.userData.manipulationAction = markerAction.action; });
        }
      }
      button.feedbackPressed =
        input.hoveredAction === button.userData.manipulationAction;
      button.update();
    }
    if ((dragging && !input.handDragging) || !handle.visible) {
      this.hoverUntil = 0;
      this.hoverProgress = 0;
    } else {
      if (input.endEffectorHovered || input.handDragging) this.hoverUntil = now + 0.3;
      this.hoverProgress +=
        ((now < this.hoverUntil ? 1 : 0) - this.hoverProgress) *
        (1 - Math.exp(-14 * dtOutline));
    }
    this.gripperMenu.visible =
      (!dragging || (input.handDragging === true && markerAction.allowDuringGrab)) &&
      !state.stopped &&
      markerAction.available &&
      this.hoverProgress > 0.01;
    this.gripperMenu.scale.setScalar(Math.max(0.01, this.hoverProgress));
    this.gripperMenu.position
      .copy(handle.position)
      .add(new THREE.Vector3(0, -0.07, 0));
    this.previewMenu.visible =
      selected && !dragging && !state.stopped && this.hoverProgress > 0.01;
    this.previewMenu.scale.setScalar(Math.max(0.01, this.hoverProgress));
    this.previewMenu.position
      .copy(handle.position)
      .add(new THREE.Vector3(0, 0.07, 0));
  }
  faceViewer(position: THREE.Vector3): void {
    this.baseMarker.lookAt(position);
    this.gripperMenu.lookAt(position);
    this.previewMenu.lookAt(position);
  }
  dispose(): void {
    for (const button of this.buttons.values()) {
      button.removeFromParent();
      button.dispose();
    }
    this.buttons.clear();
    this.frame.dispose();
    disposeObjectTrees([this.baseMarker, this.gripperMenu, this.previewMenu]);
  }
}
