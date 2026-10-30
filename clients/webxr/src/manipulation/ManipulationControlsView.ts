import type { ManipulationSnapshot } from "@dimos-ar-client/manipulation/ManipulationInteraction";
import type {
  ManipulationGroup,
  ManipulationObservation,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import * as THREE from "three";
import { Text } from "troika-three-text";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { DIMOS_AR_DESIGN } from "../presentation/DimOSARDesign";
import { GlassSurface } from "../presentation/GlassSurface";
import { PanelHeightController } from "../presentation/PanelHeightController";
import { indicatorMaterial } from "../presentation/PoseIndicatorMaterial";
import { RobotMarkerLabel } from "../presentation/RobotMarkerLabel";
import { SpeedSlider } from "../presentation/SpeedSlider";
import { SurfaceButton } from "../presentation/SurfaceButton";
import { syncText, UI_FONT_REGULAR } from "../presentation/UIFonts";
import { disposeObjectTrees } from "./ObjectResources";

export class ManipulationControlsView {
  readonly controls = new THREE.Group();
  readonly baseMarker = new THREE.Group();
  readonly baseLabel = new RobotMarkerLabel();
  readonly gripperMenu = new THREE.Group();
  readonly previewMenu = new THREE.Group();
  readonly speedSlider = new SpeedSlider(0.14);
  readonly status = new Text();
  readonly buttons = new Map<string, SurfaceButton>();
  private readonly menuHeight = new PanelHeightController();
  private readonly speedLabel = new Text();
  private readonly menuPlate: GlassSurface;
  private hoverUntil = 0;
  private hoverProgress = 0;
  constructor() {
    this.menuHeight.request(0.096, true);
    this.baseLabel.scale.setScalar(0.75);
    this.baseLabel.tagMessage.fillOpacity = 0.5;
    this.baseLabel.tagMessage.color = 0xffffff;
    const plate = new GlassSurface({
      width: 0.26,
      height: 0.13,
      radius: 0.018,
      tint: DIMOS_AR_DESIGN.colors.background,
      alpha: 0.98,
      rim: 0.08,
      rimWidth: 0.002,
    });
    this.menuPlate = plate;
    plate.userData.interactionEnabled = false;
    plate.userData.rayPriority = 15;
    registerRayTarget(plate);
    plate.renderOrder = 10;
    this.controls.add(plate);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 20, 16),
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
        font: UI_FONT_REGULAR,
        width,
        height: 0.032,
        fontSize: 0.012 / 0.032,
        opacity: 1,
        backgroundColor: DIMOS_AR_DESIGN.colors.control,
      });
      button.isRoot = true;
      button.renderOrder = 62;
      parent.add(button);
      button.updateLayouts();
      button.position.set(x, y, 0.008);
      button.setSurface(variant);
      button.traverse((node) => {
        node.userData.manipulationAction = action;
        node.renderOrder = node === button ? 62 : 63;
      });
      this.buttons.set(key, button);
      return button;
    };
    addButton("plan", this.previewMenu, "Preview", "plan", 0, 0, 0.095);
    addButton(
      "execute",
      this.controls,
      "Execute",
      "execute",
      0.054,
      0.031,
      0.135,
      "primary",
    );
    addButton("estop", this.controls, "E-stop", "estop", 0, 0, 0.2, "danger");
    addButton("reset", this.controls, "Reset", "reset", 0, 0, 0.14);
    addButton("stop", this.controls, "Stop", "stop", 0, 0, 0.14);
    this.speedSlider.hit.userData.manipulationControl = true;
    this.controls.add(this.speedSlider);
    this.speedLabel.font = UI_FONT_REGULAR;
    this.speedLabel.fontSize = 0.011;
    this.speedLabel.anchorX = "center";
    this.speedLabel.anchorY = "bottom";
    this.speedLabel.color = 0xaeaeb2;
    this.speedLabel.renderOrder = 66;
    this.speedLabel.raycast = () => {};
    this.speedSlider.add(this.speedLabel);
    this.speedLabel.position.y = 0.012;
    addButton("gripper", this.gripperMenu, "Open", "gripper", 0, 0, 0.095);
    this.status.font = UI_FONT_REGULAR;
    this.status.fontSize = 0.014;
    this.status.maxWidth = 0.34;
    this.status.position.set(-0.115, -0.045, 0.012);
    this.status.fontSize = 0.011;
    this.status.maxWidth = 0.23;
    this.status.renderOrder = 64;
    (this.status.material as THREE.Material).depthWrite = false;
    this.status.raycast = () => {};
    (this.status.material as THREE.Material).depthTest = false;
    this.controls.add(this.status);
    this.baseMarker.add(this.controls);
    this.controls.scale.setScalar(0.7);
    this.controls.position.set(0, -0.13, 0);
    plate.visible = true;
    plate.userData.interactionEnabled = false;
  }
  apply(input: {
    intent: ManipulationSnapshot;
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
      displaced,
      group,
      observed,
      handle,
      now,
      delta: dtOutline,
    } = input;
    const { dragging, stopped } = intent;
    const state = { stopped };
    this.controls.visible = true;
    this.status.visible = false;
    this.speedSlider.setValue(input.speedScale);
    const speedText = `Speed · ${Math.round(input.speedScale * 100)}%`;
    if (this.speedLabel.text !== speedText) {
      this.speedLabel.text = speedText;
      syncText(this.speedLabel);
    }
    this.speedSlider.hit.userData.interactionEnabled = intent.canManipulate;
    const rows = [
      ...(selected && !state.stopped ? ["execute"] : []),
      "reset",
      "speed",
      "stop",
      "estop",
    ];
    this.menuHeight.request(rows.length * 0.04 + 0.028);
    this.menuHeight.tick(dtOutline);
    this.menuPlate.resize(0.224, this.menuHeight.height, 0.016);
    this.menuPlate.position.y = -this.menuHeight.height / 2;
    for (const key of ["execute", "reset", "stop", "estop"])
      this.buttons.get(key)!.visible = rows.includes(key);
    rows.forEach((key, index) => {
      const control =
        key === "speed" ? this.speedSlider : this.buttons.get(key)!;
      control.position.set(
        0,
        -0.028 -
          index * 0.04 -
          (key === "speed" ? 0.01 : index > rows.indexOf("speed") ? 0.012 : 0),
        0.008,
      );
    });
    const emergency = this.buttons.get("estop")!;
    const emergencyAction = state.stopped ? "resume" : "estop";
    if (emergency.userData.mode !== emergencyAction) {
      emergency.userData.mode = emergencyAction;
      emergency.setText(state.stopped ? "Resume operation" : "E-stop");
      emergency.setVariant(state.stopped ? "primary" : "danger");
      emergency.traverse((node) => {
        node.userData.manipulationAction = emergencyAction;
      });
    }
    for (const [key, button] of this.buttons) {
      button.setEnabled(intent.canManipulate);
      if (key === "estop")
        button.setEnabled(intent.canStop || intent.canResume);
      if (key === "stop") button.setEnabled(intent.canStop);
      if (key === "reset") button.setEnabled(intent.canReset);
      if (key === "execute") button.setEnabled(intent.canExecute);
      if (key === "plan") {
        button.setActive(input.previewRequested);
        button.setEnabled(intent.canPreview);
      }
      if (key === "gripper") {
        button.visible = group?.has_gripper === true;
        const value = selected
          ? (input.desiredGripper ?? observed?.gripper)
          : observed?.gripper;
        button.setText(
          value == null ? "Gripper —" : value < 0.5 ? "Open" : "Close",
        );
      }
      button.feedbackPressed =
        input.hoveredAction === button.userData.manipulationAction;
      button.update();
    }
    if (dragging || !handle.visible) {
      this.hoverUntil = 0;
      this.hoverProgress = 0;
    } else {
      if (input.endEffectorHovered) this.hoverUntil = now + 0.3;
      this.hoverProgress +=
        ((now < this.hoverUntil ? 1 : 0) - this.hoverProgress) *
        (1 - Math.exp(-14 * dtOutline));
    }
    this.gripperMenu.visible =
      !dragging &&
      !state.stopped &&
      group?.has_gripper === true &&
      this.hoverProgress > 0.01;
    this.gripperMenu.scale.setScalar(Math.max(0.01, this.hoverProgress));
    this.gripperMenu.position
      .copy(handle.position)
      .add(new THREE.Vector3(0, -0.055 - this.hoverProgress * 0.025, 0));
    this.previewMenu.visible =
      selected && displaced && !dragging && !state.stopped;
    this.previewMenu.position
      .copy(handle.position)
      .add(new THREE.Vector3(0, 0.08, 0));
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
    disposeObjectTrees([this.baseMarker, this.gripperMenu, this.previewMenu]);
  }
}
