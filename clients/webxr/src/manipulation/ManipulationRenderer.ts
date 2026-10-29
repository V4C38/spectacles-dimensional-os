import { gripperJointValues } from "./ArmToolKinematics";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OPENYAM_FOREARM_BOXES } from "./OpenYAMVisualProfile";
import { shortManipulationStatus } from "@dimos-ar-client/manipulation/ManipulationInteraction";
import { ArmJointFilter } from "./ArmJointFilter";
import { ArmTrajectoryProgress } from "./ArmTrajectoryProgress";
import { SpeedSlider } from "../presentation/SpeedSlider";
import {
  targetIsOffset,
  type ManipulationSnapshot,
} from "@dimos-ar-client/manipulation/ManipulationInteraction";
import { WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import { PanelHeightController } from "../presentation/PanelHeightController";
import { TargetWarning } from "./TargetWarning";
import { SurfaceButton } from "../presentation/SurfaceButton";
import { RobotMarkerLabel } from "../presentation/RobotMarkerLabel";
import { RobotBoundsAnimation } from "../presentation/RobotBoundsAnimation";
import { armMaterial } from "./ArmMaterial";
import { GlassSurface } from "../presentation/GlassSurface";
import { DIMOS_AR_DESIGN } from "../presentation/DimOSARDesign";
import { indicatorMaterial } from "../presentation/PoseIndicatorMaterial";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Text } from "troika-three-text";
import {
  composePose,
  linkPoses,
  samplePlan,
} from "@dimos-ar-client/manipulation/ModelKinematics";
import type {
  ManipulationModel,
  ManipulationPlan,
  ManipulationPose,
  ManipulationState,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import {
  clientTrackingToWebxrPoint,
  clientTrackingToWebxrPose,
} from "../utilities/WebXRCoordinates";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { syncText, UI_FONT_REGULAR } from "../presentation/UIFonts";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { EndEffectorHandleRenderer } from "./EndEffectorHandleRenderer";

const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...clientTrackingToWebxrPoint([1, 0, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 1, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 0, 1])),
);
const OPENYAM_BASE_BOUNDS_ROTATION = new THREE.Matrix4().makeRotationY(
  Math.PI / 2,
);
export class ManipulationRenderer {
  readonly object = new THREE.Group();
  readonly handle = new EndEffectorHandleRenderer();
  private readonly pathStroke = new AdaptiveDashedLineRenderer(WORLD_DASH_STYLE.widthM * 0.65, WORLD_DASH_STYLE.dashM, WORLD_DASH_STYLE.gapM, 1.3);
  readonly path = this.pathStroke.object;
  private pathKey = "";
  private previewWasRequested = false;
  private readonly menuHeight = new PanelHeightController();
  private menuPlate!: GlassSurface;
  private previewId: string | null = null;
  private previewStarted = 0;
  private readonly boundsAnimation = new RobotBoundsAnimation();
  private outlineTime = 0;
  readonly measuredHandle = new EndEffectorHandleRenderer();
  private readonly boundStrokes = new Map<string, AdaptiveDashedLineRenderer>();
  private readonly bounds = new Map<string, THREE.Group>();
  private readonly previewMeshes = new Map<string, THREE.Object3D>();
  private readonly ghosts = new Map<string, THREE.Object3D>();
  private readonly controls = new THREE.Group();
  readonly panel = this.controls;
  readonly baseMarker = new THREE.Group();
  readonly gripperMenu = new THREE.Group();
  private readonly baseLabel = new RobotMarkerLabel();
  private readonly buttons = new Map<string, SurfaceButton>();
  previewRequested = false;
  desiredGripper: number | null = null;
  private readonly basePosition = new THREE.Vector3();
  readonly speedSlider = new SpeedSlider(0.14);
  private readonly speedLabel = new Text();
  private readonly ikSegments = new Map<string, AdaptiveDashedLineRenderer>();
  readonly previewMenu = new THREE.Group();
  private readonly jointFilter = new ArmJointFilter();
  private readonly trajectoryProgress = new ArmTrajectoryProgress();
  private filterOrigin: ClientTrackingOrigin | null = null;
  private filterGroup: string | null = null;
  private feedbackWasFresh = false;
  private offsetBefore = false;
  readonly warning = new TargetWarning();
  rejection: {
    revision: number;
    pose: ManipulationPose;
    message: string;
  } | null = null;
  private selectedBefore = false;
  private hoverUntil = 0;
  private hoverProgress = 0;
  private eeGeometry: THREE.Object3D | null = null;
  pinned = false;
  eeHovered = false;
  hoveredAction: string | null = null;
  private readonly status = new Text();
  private model: ManipulationModel | null = null;
  private disposed = false;
  private assetGeneration = 0;
  private assetMessage = "";
  hoveredLink: string | null = null;
  constructor() {
    this.object.name = "Manipulation";
    this.menuHeight.request(0.096, true);
    this.path.userData.environmentDepth = true;
    this.path.raycast = () => {};
    this.object.add(this.warning.object, this.warning.rejected);
    (this.handle.collider.material as THREE.Material).transparent = true;
    (this.handle.collider.material as THREE.Material).depthWrite = false;
    this.handle.collider.scale.setScalar(1.04);
    this.measuredHandle.collider.userData.interactionEnabled = false;
    this.measuredHandle.collider.raycast = () => {};
    this.measuredHandle.collider.scale.setScalar(0.65);
    (
      this.measuredHandle.collider.material as THREE.ShaderMaterial
    ).uniforms.uOpacity.value = 0.25;
    this.baseLabel.scale.setScalar(0.75);
    this.baseLabel.tagMessage.fillOpacity = 0.5;
    this.baseLabel.tagMessage.color = 0xffffff;
    this.object.add(this.measuredHandle.object);
    this.object.add(
      this.path,
      this.handle.object,
      this.controls,
      this.baseMarker,
      this.gripperMenu,
      this.previewMenu,
    );
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
  speedScale = 0.2;
  faceViewer(position: THREE.Vector3): void {
    this.baseMarker.lookAt(position);
    this.warning.faceViewer(position);
    this.gripperMenu.lookAt(position);
    this.previewMenu.lookAt(position);
  }
  owns(object: THREE.Object3D): boolean {
    return (
      object === this.handle.collider ||
      !!object.userData.manipulationLink ||
      !!object.userData.manipulationPanel ||
      !!object.userData.manipulationControl ||
      !!object.userData.manipulationAction
    );
  }
  apply(
    state: ManipulationState | null | undefined,
    origin: ClientTrackingOrigin | null,
    groupId: string | null,
    selected: boolean,
    target: ManipulationPose | null,
    solution: Record<string, number> | null,
    plan: ManipulationPlan | null,
    now: number,
    message: string,
    fresh = true,
    robotTitle = "Arm",
    intent?: ManipulationSnapshot,
  ): void {
    this.object.visible = !!state?.available && !!origin;
    if (!this.object.visible || !state?.model || !origin) {
      this.jointFilter.reset();
      this.trajectoryProgress.reset();
      this.previewRequested = false;
      return;
    }
    if (this.model?.revision !== state.model.revision)
      this.rebuild(state.model);
    const model = state.model,
      observed = groupId ? state.observations?.[groupId] : null;
    const all = Object.assign(
      {},
      ...Object.values(state.observations ?? {}).map((o) => o.joints ?? {}),
    );
    const rootPose =
      state.root_pose ??
      ({ position: [0, 0, 0], orientation: [0, 0, 0, 1] } as ManipulationPose);
    const activeGroup = state.groups?.find((g) => g.id === groupId);
    Object.assign(all, gripperJointValues(model, activeGroup, observed?.gripper));
    if (origin !== this.filterOrigin || groupId !== this.filterGroup) {
      this.jointFilter.reset();
      this.trajectoryProgress.reset();
      this.filterOrigin = origin;
      this.filterGroup = groupId;
    }
    if (fresh !== this.feedbackWasFresh) this.jointFilter.reset();
    this.feedbackWasFresh = fresh;
    const filtered = this.jointFilter.sample(
      model,
      all,
      `${model.revision}:${groupId}`,
      now,
    );
    const measured = linkPoses(model, filtered);
    const targetVisible =
      !!target &&
      (selected || state.following === true || intent?.dragging === true);
    const offset =
      intent?.targetOffset ??
      targetIsOffset(target, observed?.pose, this.offsetBefore);
    this.offsetBefore = offset;
    const displaced = targetVisible && offset;
    const dragging = intent?.dragging === true;
    const executing =
      intent?.executing ??
      ["accepted", "executing"].includes(state.execution ?? "");
    const base = clientTrackingToWebxrPose(
      odomToClientTrackingPose(rootPose, origin),
    );
    this.basePosition.fromArray(base.position);
    this.baseMarker.position
      .copy(this.basePosition)
      .add(new THREE.Vector3(0.1, 0.08, 0));
    if (selected !== this.selectedBefore) {
      this.pinned = false;
      this.previewRequested = false;
    }
    this.selectedBefore = selected;
    const stateText = intent?.activity ?? (!fresh ? "No feedback" : state.stopped ? "Stopped" : executing || state.following ? "Moving" : this.rejection ? shortManipulationStatus(message) : displaced ? "Planning" : "Idle");
    this.baseLabel.setFeedback(
      robotTitle,
      stateText,
      `${Math.round(this.speedScale * 100)}%`,
      !fresh ? 0xff9f0a : state.stopped ? 0xff453a : 0x30d158,
    );
    this.updateGripperBounds(model, measured, groupId, state);
    const dtOutline = this.outlineTime
      ? Math.max(0, Math.min(0.1, now - this.outlineTime))
      : 1 / 60;
    this.outlineTime = now;
    const highlighted = selected || this.hoveredLink !== null;
    const animation = this.boundsAnimation.update(
      selected,
      highlighted,
      dtOutline,
    );
    for (const link of model.links) {
      const box = this.bounds.get(link.name);
      if (!box) continue;
      this.place(box, composePose(rootPose, measured[link.name]), origin);
      const stroke = this.boundStrokes.get(link.name);
      if (stroke) {
        stroke.object.visible = this.boundsAnimation.progress > 0;
        const center = new THREE.Vector3(...(box.userData.boundsCenter ?? link.bounds!.center)).applyMatrix4(BASIS);
        const size = new THREE.Vector3(...(box.userData.boundsSize ?? link.bounds!.size)).applyMatrix4(BASIS);
        if (box.userData.openyamBaseBounds) {
          center.applyMatrix4(OPENYAM_BASE_BOUNDS_ROTATION);
          size.applyMatrix4(OPENYAM_BASE_BOUNDS_ROTATION);
        }
        const longest = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
        const axis = longest.indexOf(Math.max(...longest));
        const t = this.boundsAnimation.progress;
        const cross = t * t * (3 - 2 * t);
        const scale = new THREE.Vector3(cross, cross, cross);
        scale.setComponent(axis, 1);
        stroke.object.scale.copy(scale);
        stroke.object.position.copy(center).multiply(new THREE.Vector3(1, 1, 1).sub(scale));
        stroke.setStyle(animation.width * 0.65, animation.opacity);
      }
    }
    const activePlan = !state.stopped
      ? ((executing ? state.plan : plan) ?? null)
      : null;
    if (dragging || state.stopped || (!activePlan && !intent?.planning))
      this.previewRequested = false;
    if (activePlan?.plan_id !== this.previewId) {
      this.previewId = activePlan?.plan_id ?? null;
      this.previewStarted = now;
    }
    if (this.previewRequested && !this.previewWasRequested)
      this.previewStarted = now;
    this.previewWasRequested = this.previewRequested;
    const playbackTime = now - this.previewStarted;
    const playing =
      this.previewRequested &&
      !!activePlan &&
      playbackTime <= activePlan.duration;
    if (
      this.previewRequested &&
      activePlan &&
      playbackTime > activePlan.duration
    )
      this.previewRequested = false;
    const configuration =
      playing && activePlan
        ? samplePlan(activePlan, Math.max(0, playbackTime))
        : selected
          ? activePlan
            ? samplePlan(activePlan, activePlan.duration)
            : solution
          : null;
    this.updateIKGuide(model, filtered, solution, rootPose, origin, groupId, state,
                       !selected && dragging && displaced, fresh, this.rejection !== null);
    const targetValues = { ...filtered, ...configuration };
    Object.assign(targetValues, gripperJointValues(model, activeGroup, this.desiredGripper));
    const preview = configuration ? linkPoses(model, targetValues) : null;
    for (const [name, ghost] of this.ghosts) {
      ghost.visible = selected && displaced && preview === null;
      this.place(ghost, composePose(rootPose, measured[name]), origin);
    }
    for (const [name, ghost] of this.previewMeshes) {
      ghost.visible = selected && (displaced || playing) && preview !== null;
      if (preview)
        this.place(ghost, composePose(rootPose, preview[name]), origin);
    }
    const group = state.groups?.find((g) => g.id === groupId);
    if (!this.eeGeometry && group?.tip_frame && this.ghosts.size) {
      let toolRoot = group.tip_frame;
      let parent = model.joints.find((j) => j.child === toolRoot);
      while (parent?.kind === "fixed") {
        toolRoot = parent.parent;
        parent = model.joints.find((j) => j.child === toolRoot);
      }
      const links = new Set([toolRoot]);
      for (let pass = 0; pass < model.links.length; pass++)
        for (const j of model.joints)
          if (links.has(j.parent)) links.add(j.child);
      const root = new THREE.Group();
      for (const name of links) {
        const visual = this.ghosts.get(name);
        if (!visual) continue;
        const clone = visual.clone(true);
        clone.visible = true;
        clone.userData.toolLink = name;
        clone.traverse((part) => {
          part.raycast = () => {};
          if (part instanceof THREE.Mesh) part.material = armMaterial(true);
        });
        root.add(clone);
      }
      this.eeGeometry = root;
      this.object.add(root);
    }
    if (this.eeGeometry && group?.tip_frame) {
      const values = { ...filtered };
      const opening = selected ? this.desiredGripper : null;
      Object.assign(values, gripperJointValues(model, group, opening));
      const poses = linkPoses(model, values);
      const matrix = (pose: ManipulationPose) => {
        const p = clientTrackingToWebxrPose(pose);
        return new THREE.Matrix4().compose(
          new THREE.Vector3(...p.position),
          new THREE.Quaternion(...p.orientation),
          new THREE.Vector3(1, 1, 1),
        );
      };
      const inverse = matrix(poses[group.tip_frame]).invert();
      for (const child of this.eeGeometry.children) {
        const pose = poses[child.userData.toolLink];
        if (pose)
          inverse
            .clone()
            .multiply(matrix(pose))
            .decompose(child.position, child.quaternion, new THREE.Vector3());
      }
    }
    if (this.eeGeometry)
      this.eeGeometry.visible = !!observed?.pose && displaced;
    this.handle.collider.userData.interactionEnabled =
      fresh && !state.stopped && !executing && !intent?.resetting;
    this.path.visible = (displaced || !!activePlan && (playing || executing)) && !!group?.tip_frame;
    this.pathStroke.setStyle(WORLD_DASH_STYLE.widthM * 0.65, activePlan ? 0.7 : 0.25);
    if (!activePlan && targetVisible && target && observed?.pose) {
      const start = clientTrackingToWebxrPose(
        odomToClientTrackingPose(observed.pose, origin),
      );
      const end = clientTrackingToWebxrPose(
        odomToClientTrackingPose(target, origin),
      );
      this.pathStroke.setSegments([start.position, end.position], true);
      this.pathKey = "";
    }
    const pathTime =
      activePlan && executing
        ? fresh && observed?.joints
          ? this.trajectoryProgress.advance(
              activePlan,
              observed.joints,
              new Set(
                model.joints
                  .filter((j) => j.kind === "continuous")
                  .map((j) => j.name),
              ),
              state.operation_id ?? activePlan.plan_id,
            )
          : this.trajectoryProgress.time
        : 0;
    if (!activePlan || !executing) this.trajectoryProgress.reset();
    const pathKey =
      activePlan && group?.tip_frame
        ? JSON.stringify([
            activePlan.plan_id,
            pathTime,
            model.revision,
            group.tip_frame,
            origin,
            rootPose,
          ])
        : "";
    if (activePlan && group?.tip_frame && pathKey !== this.pathKey) {
      this.pathKey = pathKey;
      const points: THREE.Vector3[] = [];
      const count = Math.min(
        240,
        Math.max(2, Math.ceil(activePlan.duration * 30)),
      );
      for (let i = 0; i <= count; i++) {
        const pose = linkPoses(model, {
          ...all,
          ...samplePlan(
            activePlan,
            pathTime + ((activePlan.duration - pathTime) * i) / count,
          ),
        })[group.tip_frame];
        if (pose)
          points.push(
            new THREE.Vector3(
              ...clientTrackingToWebxrPose(
                odomToClientTrackingPose(composePose(rootPose, pose), origin),
              ).position,
            ),
          );
      }
      this.pathStroke.setSegments(
        points
          .slice(0, -1)
          .flatMap((point, i) => [
            point.toArray() as Vec3,
            points[i + 1].toArray() as Vec3,
          ]),
        true,
      );
    }
    this.measuredHandle.object.visible = displaced && !!observed?.pose;
    if (observed?.pose)
      this.place(this.measuredHandle.object, observed.pose, origin);
    (
      this.handle.collider.material as THREE.ShaderMaterial
    ).uniforms.uOpacity.value = selected ? 0.42 : 1;
    this.handle.object.visible = !!observed?.pose;
    if (observed?.pose)
      this.place(
        this.handle.object,
        targetVisible && (offset || dragging) && target
          ? target
          : observed.pose,
        origin,
      );

    this.controls.visible = true;
    this.status.visible = false;
    this.speedSlider.setValue(this.speedScale);
    const speedText = `Speed · ${Math.round(this.speedScale * 100)}%`;
    if (this.speedLabel.text !== speedText) { this.speedLabel.text = speedText; syncText(this.speedLabel); }
    this.speedSlider.hit.userData.interactionEnabled =
      fresh && !state.stopped && !executing && !intent?.resetting;
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
      control.position.set(0, -0.028 - index * 0.04 - (key === "speed" ? 0.01 : index > rows.indexOf("speed") ? 0.012 : 0), 0.008);
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
      button.setEnabled(
        fresh && !state.stopped && !executing && !intent?.resetting,
      );
      if (key === "estop")
        button.setEnabled(
          !state.stopped || (fresh && state.stop_confirmed === true),
        );
      if (key === "stop") button.setEnabled(!state.stopped);
      if (key === "reset")
        button.setEnabled(
          intent?.canReset ?? (fresh && !state.stopped && !executing),
        );
      if (key === "execute")
        button.setEnabled(
          intent?.canExecute ?? (fresh && displaced && !executing),
        );
      if (key === "plan") {
        button.setActive(this.previewRequested);
        button.setEnabled(
          intent?.canPreview ?? (fresh && displaced && !executing),
        );
      }
      if (key === "gripper") {
        button.visible = group?.has_gripper === true;
        const value = selected
          ? (this.desiredGripper ?? observed?.gripper)
          : observed?.gripper;
        button.setText(
          value == null ? "Gripper —" : value < 0.5 ? "Open" : "Close",
        );
      }
      button.feedbackPressed =
        this.hoveredAction === button.userData.manipulationAction;
      button.update();
    }
    if (dragging || !this.handle.object.visible) {
      this.hoverUntil = 0;
      this.hoverProgress = 0;
    } else {
      if (this.eeHovered) this.hoverUntil = now + 0.3;
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
      .copy(this.handle.object.position)
      .add(new THREE.Vector3(0, -0.055 - this.hoverProgress * 0.025, 0));
    this.previewMenu.visible =
      selected && displaced && !dragging && !state.stopped;
    this.previewMenu.position
      .copy(this.handle.object.position)
      .add(new THREE.Vector3(0, 0.08, 0));
    if (this.eeGeometry) {
      this.eeGeometry.position.copy(this.handle.object.position);
      this.eeGeometry.quaternion.copy(this.handle.object.quaternion);
    }
    const failed = !fresh || this.warning.object.visible;
    if (this.rejection) {
      const pose = clientTrackingToWebxrPose(
        odomToClientTrackingPose(this.rejection.pose, origin),
      );
      this.warning.show(
        this.rejection.revision,
        this.rejection.message,
        new THREE.Vector3(...pose.position),
        now,
      );
    }
    this.warning.update(this.handle.object.position, now, intent?.dragging === true && this.rejection !== null);
    const handleMaterial = this.handle.collider
      .material as THREE.ShaderMaterial;
    handleMaterial.uniforms?.uCenterColor?.value.set(
      failed ? DIMOS_AR_DESIGN.colors.warning : DIMOS_AR_DESIGN.colors.chrome,
    );
    const copy = `${robotTitle} · ${!fresh ? "Feedback unavailable" : stateText}${this.assetMessage}`;
    if (this.status.text !== copy) {
      this.status.text = copy;
      syncText(this.status);
    }
  }
  private updateIKGuide(model: ManipulationModel, measured: Record<string, number>,
    solution: Record<string, number> | null, root: ManipulationPose, origin: ClientTrackingOrigin,
    groupId: string | null, state: ManipulationState, visible: boolean, fresh: boolean, failed: boolean): void {
    for (const stroke of this.ikSegments.values()) stroke.object.visible = false;
    if (!visible || !fresh || !solution) return;
    const group = state.groups?.find(g => g.id === groupId);
    if (!group?.tip_frame) return;
    const current = linkPoses(model, measured), proposed = linkPoses(model, { ...measured, ...solution });
    let tip = group.tip_frame;
    for (let count = 0; count < model.joints.length; count++) {
      const joint = model.joints.find(j => j.child === tip);
      if (!joint) break;
      const a = proposed[joint.parent], b = proposed[joint.child];
      const ca = current[joint.parent], cb = current[joint.child];
      const distance = Math.max(Math.hypot(...a.position.map((v,i) => v-ca.position[i])), Math.hypot(...b.position.map((v,i) => v-cb.position[i])));
      const angle = 2*Math.acos(Math.min(1,Math.abs(b.orientation.reduce((n,v,i) => n+v*cb.orientation[i],0))));
      const weight = THREE.MathUtils.smoothstep(Math.max(distance/0.08, angle/(Math.PI/6)), 0.06, 1);
      if (Math.hypot(...a.position.map((v,i) => v-b.position[i])) > 0.001) {
        let stroke = this.ikSegments.get(joint.name);
        if (!stroke) { stroke = new AdaptiveDashedLineRenderer(WORLD_DASH_STYLE.widthM * 0.65, WORLD_DASH_STYLE.dashM, WORLD_DASH_STYLE.gapM, 1.3); this.ikSegments.set(joint.name, stroke); this.object.add(stroke.object); stroke.object.userData.environmentDepth = true; }
        const convert = (pose: ManipulationPose) => clientTrackingToWebxrPose(odomToClientTrackingPose(composePose(root, pose), origin)).position;
        stroke.setSegments([convert(a), convert(b)]);
        stroke.setStyle(WORLD_DASH_STYLE.widthM*0.65, weight*0.7);
        const q = solution[joint.name], limits = joint.limits;
        const nearLimit = limits && q != null && Math.min(q-limits.lower,limits.upper-q) <= (limits.upper-limits.lower)*0.05;
        stroke.object.material.uniforms.uColor.value.setHex(failed ? 0xff453a : nearLimit ? 0xff9f0a : 0xffffff);
        stroke.object.visible = weight > 0.001;
      }
      tip = joint.parent;
      if (tip === group.base_frame) break;
    }
  }
  private place(
    object: THREE.Object3D,
    pose: ManipulationPose | undefined,
    origin: ClientTrackingOrigin,
  ): void {
    if (!pose) {
      object.visible = false;
      return;
    }
    const converted = clientTrackingToWebxrPose(
      odomToClientTrackingPose(pose, origin),
    );
    object.position.fromArray(converted.position);
    object.quaternion.fromArray(converted.orientation);
  }
  private updateGripperBounds(
    model: ManipulationModel,
    poses: Record<string, ManipulationPose>,
    groupId: string | null,
    state: ManipulationState,
  ): void {
    const group = state.groups?.find((g) => g.id === groupId);
    if (!group?.tip_frame || !group.has_gripper) return;
    let root = group.tip_frame;
    let parent = model.joints.find((j) => j.child === root);
    while (parent?.kind === "fixed") {
      root = parent.parent;
      parent = model.joints.find((j) => j.child === root);
    }
    const links = new Set([root]);
    for (let pass = 0; pass < model.joints.length; pass++)
      for (const joint of model.joints)
        if (links.has(joint.parent)) links.add(joint.child);
    const matrix = (pose: ManipulationPose) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(...pose.position),
        new THREE.Quaternion(...pose.orientation),
        new THREE.Vector3(1, 1, 1),
      );
    if (!poses[root]) return;
    const inverse = matrix(poses[root]).invert();
    const union = new THREE.Box3();
    for (const link of model.links) {
      if (!links.has(link.name) || !link.bounds || !poses[link.name]) continue;
      const transform = inverse.clone().multiply(matrix(poses[link.name]));
      const center = new THREE.Vector3(...link.bounds.center);
      const half = new THREE.Vector3(...link.bounds.size).multiplyScalar(0.5);
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1])
            union.expandByPoint(
              new THREE.Vector3(x, y, z)
                .multiply(half)
                .add(center)
                .applyMatrix4(transform),
            );
      if (link.name !== root) {
        const box = this.bounds.get(link.name);
        if (box) box.visible = false;
      }
    }
    if (union.isEmpty()) return;
    const box = this.bounds.get(root);
    const stroke = this.boundStrokes.get(root);
    const rootLink = model.links.find((l) => l.name === root);
    if (!box || !stroke || !rootLink) return;
    const center = union.getCenter(new THREE.Vector3());
    const size = union.getSize(new THREE.Vector3());
    const key = [...center.toArray(), ...size.toArray()]
      .map((v) => v.toFixed(5))
      .join(",");
    box.visible = true;
    if (box.userData.gripperBoundsKey === key) return;
    box.userData.gripperBoundsKey = key;
    box.userData.boundsCenter = center.toArray();
    box.userData.boundsSize = size.toArray();
    const geometry = new THREE.BoxGeometry(...size.toArray());
    geometry.translate(...center.toArray());
    geometry.applyMatrix4(BASIS);
    const collider = box.children.find(
      (c) => c.userData.manipulationLink === root,
    ) as THREE.Mesh;
    collider.geometry.dispose();
    collider.geometry = geometry;
    const edges = new THREE.EdgesGeometry(geometry);
    const positions = edges.getAttribute("position");
    stroke.setSegments(
      Array.from(
        { length: positions.count },
        (_, i) =>
          [positions.getX(i), positions.getY(i), positions.getZ(i)] as Vec3,
      ),
    );
    edges.dispose();
  }
  private rebuild(model: ManipulationModel): void {
    this.clearModel();
    this.model = model;
    for (const link of model.links) {
      if (!link.bounds) continue;
      const group = new THREE.Group();
      let geometry: THREE.BufferGeometry;
      if (model.asset_url === "/models/openyam.glb" && link.name === "link3") {
        const parts = OPENYAM_FOREARM_BOXES.map(box => {
          const g = new THREE.BoxGeometry(...box.size); g.translate(...box.center); return g;
        });
        geometry = mergeGeometries(parts);
        parts.forEach(part => part.dispose());
      } else {
        geometry = new THREE.BoxGeometry(...link.bounds.size);
        geometry.translate(...link.bounds.center);
      }
      geometry.applyMatrix4(BASIS);
      // Match the existing OpenYAM base visual correction, on this box only.
      // Keep link/world transforms and all arm mesh geometry untouched.
      if (
        link.name === model.root &&
        model.asset_url === "/models/openyam.glb"
      ) {
        group.userData.openyamBaseBounds = true;
        geometry.applyMatrix4(OPENYAM_BASE_BOUNDS_ROTATION);
      }

      const edges = new THREE.EdgesGeometry(geometry),
        positions = edges.getAttribute("position");
      const stroke = new AdaptiveDashedLineRenderer(WORLD_DASH_STYLE.widthM * 0.65, WORLD_DASH_STYLE.dashM, WORLD_DASH_STYLE.gapM, 1.3);
      stroke.setSegments(
        Array.from(
          { length: positions.count },
          (_, i) =>
            [positions.getX(i), positions.getY(i), positions.getZ(i)] as Vec3,
        ),
      );
      edges.dispose();
      this.boundStrokes.set(link.name, stroke);
      const outline = stroke.object;
      outline.userData.environmentDepth = true;
      outline.raycast = () => {};
      const collider = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      collider.name = `LinkBounds_${link.name}`;
      collider.userData.manipulationLink = link.name;
      collider.userData.rayPriority = 20;
      registerRayTarget(collider);
      group.add(outline, collider);
      this.bounds.set(link.name, group);
      this.object.add(group);
    }
    const generation = ++this.assetGeneration;
    if (model.asset_url)
      new GLTFLoader().load(
        model.asset_url,
        (gltf) => {
          if (this.disposed || generation !== this.assetGeneration) {
            this.disposeTree(gltf.scene);
            return;
          }
          if (
            model.visual_signature &&
            gltf.scene.userData.visual_signature !== model.visual_signature
          ) {
            this.disposeTree(gltf.scene);
            this.assetMessage =
              "\nPreview mesh does not match configured robot model";
            return;
          }
          for (const link of model.links) {
            const node = gltf.scene.getObjectByName(link.name);
            if (!node) continue;
            node.removeFromParent();
            node.position.set(0, 0, 0);
            node.quaternion.identity();
            node.scale.setScalar(1);
            node.traverse((part) => {
              part.raycast = () => {};
              if (part instanceof THREE.Mesh) {
                if (!part.geometry.getAttribute("normal"))
                  part.geometry.computeVertexNormals();
                part.geometry.applyMatrix4(BASIS);
                if (link.name === model.root)
                  part.geometry.rotateY(Math.PI / 2);
                const old = Array.isArray(part.material)
                  ? part.material
                  : [part.material];
                old.forEach((m) => m.dispose());
                part.material = armMaterial();
                const edge = new THREE.LineSegments(
                  new THREE.EdgesGeometry(part.geometry, 35),
                  new THREE.LineBasicMaterial({
                    color: 0xe8f1f4,
                    transparent: true,
                    opacity: 0.12,
                    depthWrite: false,
                  }),
                );
                edge.raycast = () => {};
                part.add(edge);
              }
            });
            const previewNode = node.clone(true);
            previewNode.traverse((part) => {
              if (part instanceof THREE.Mesh) part.material = armMaterial();
            });
            previewNode.visible = false;
            this.previewMeshes.set(link.name, previewNode);
            this.object.add(previewNode);
            this.ghosts.set(link.name, node);

            this.object.add(node);
          }
          this.disposeTree(gltf.scene);
          this.assetMessage = "";
        },
        undefined,
        () => {
          if (generation === this.assetGeneration)
            this.assetMessage = "\nPreview mesh unavailable";
        },
      );
  }
  private disposeTree(root: THREE.Object3D): void {
    root.traverse((part) => {
      if (part instanceof Text) part.dispose();
      else if (part instanceof THREE.Mesh || part instanceof THREE.Line) {
        part.geometry.dispose();
        (Array.isArray(part.material)
          ? part.material
          : [part.material]
        ).forEach((m) => m.dispose());
      }
    });
    root.removeFromParent();
  }
  private clearModel(): void {
    if (this.eeGeometry) {
      this.eeGeometry.removeFromParent();
      this.eeGeometry.traverse((p) => {
        if (p instanceof THREE.Mesh) (p.material as THREE.Material).dispose();
      });
      this.eeGeometry = null;
    }
    for (const stroke of this.ikSegments.values()) stroke.dispose();
    this.ikSegments.clear();
    this.assetGeneration++;
    this.pathKey = "";
    this.jointFilter.reset();
    this.trajectoryProgress.reset();
    for (const stroke of this.boundStrokes.values()) stroke.dispose();
    this.boundStrokes.clear();
    for (const part of this.previewMeshes.values()) {
      part.removeFromParent();
      part.traverse((p) => {
        if (p instanceof THREE.Mesh) (p.material as THREE.Material).dispose();
      });
    }
    this.previewMeshes.clear();
    for (const part of [...this.bounds.values(), ...this.ghosts.values()])
      this.disposeTree(part);
    this.bounds.clear();
    this.ghosts.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.clearModel();
    for (const button of this.buttons.values()) {
      button.removeFromParent();
      button.dispose();
    }
    this.buttons.clear();
    this.pathStroke.dispose();
    this.handle.dispose();
    this.measuredHandle.dispose();
    this.warning.dispose();
    this.disposeTree(this.object);
  }
}
