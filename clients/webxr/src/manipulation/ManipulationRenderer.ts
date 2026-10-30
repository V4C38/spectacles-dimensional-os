import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { type ManipulationSnapshot } from "@dimos-ar-client/manipulation/ManipulationInteraction";
import type {
  ManipulationModel,
  ManipulationPlan,
  ManipulationPose,
  ManipulationState,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import {
  composePose,
  linkPoses,
  samplePlan,
} from "@dimos-ar-client/manipulation/ModelKinematics";
import { WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import * as THREE from "three";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import { DIMOS_AR_DESIGN } from "../presentation/DimOSARDesign";
import { RobotBoundsAnimation } from "../presentation/RobotBoundsAnimation";
import { syncText } from "../presentation/UIFonts";
import {
  clientTrackingToWebxrPoint,
  clientTrackingToWebxrPose,
} from "../utilities/WebXRCoordinates";
import { ArmJointFilter } from "./ArmJointFilter";
import { gripperJointValues } from "./ArmToolKinematics";
import { ArmTrajectoryProgress } from "./ArmTrajectoryProgress";
import { EndEffectorHandleRenderer } from "./EndEffectorHandleRenderer";
import { ManipulationControlsView } from "./ManipulationControlsView";
import { ManipulationModelRenderer } from "./ManipulationModelRenderer";
import { TargetWarning } from "./TargetWarning";

const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...clientTrackingToWebxrPoint([1, 0, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 1, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 0, 1])),
);
export interface ManipulationPresentation {
  state: ManipulationState | null | undefined;
  origin: ClientTrackingOrigin | null;
  groupId: string | null;
  selected: boolean;
  target: ManipulationPose | null;
  solution: Record<string, number> | null;
  plan: ManipulationPlan | null;
  now: number;
  robotTitle: string;
  intent: ManipulationSnapshot;
  speedScale: number;
  desiredGripper: number | null;
  rejection: {
    revision: number;
    pose: ManipulationPose;
    message: string;
  } | null;
}

export class ManipulationRenderer {
  readonly object = new THREE.Group();
  private readonly modelRenderer = new ManipulationModelRenderer();
  private readonly boundsAnimation = new RobotBoundsAnimation();
  readonly controlsView = new ManipulationControlsView();
  readonly panel = this.controlsView.controls;
  readonly baseMarker = this.controlsView.baseMarker;
  readonly gripperMenu = this.controlsView.gripperMenu;
  readonly previewMenu = this.controlsView.previewMenu;
  readonly speedSlider = this.controlsView.speedSlider;
  readonly handle = new EndEffectorHandleRenderer();
  private readonly pathStroke = new AdaptiveDashedLineRenderer(
    WORLD_DASH_STYLE.widthM * 0.65,
    WORLD_DASH_STYLE.dashM,
    WORLD_DASH_STYLE.gapM,
    1.3,
  );
  readonly path = this.pathStroke.object;
  private pathKey = "";
  private previewWasRequested = false;
  private previewId: string | null = null;
  private previewStarted = 0;
  private outlineTime = 0;
  readonly measuredHandle = new EndEffectorHandleRenderer();
  previewRequested = false;
  private readonly basePosition = new THREE.Vector3();
  private readonly ikSegments = new Map<string, AdaptiveDashedLineRenderer>();
  private readonly jointFilter = new ArmJointFilter();
  private readonly trajectoryProgress = new ArmTrajectoryProgress();
  private filterOrigin: ClientTrackingOrigin | null = null;
  private filterGroup: string | null = null;
  private feedbackWasFresh = false;
  readonly warning = new TargetWarning();
  private selectedBefore = false;
  pinned = false;
  eeHovered = false;
  hoveredAction: string | null = null;
  hoveredLink: string | null = null;
  constructor() {
    this.object.name = "Manipulation";
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
    this.object.add(this.measuredHandle.object);
    this.object.add(
      this.modelRenderer.object,
      this.path,
      this.handle.object,
      this.baseMarker,
      this.gripperMenu,
      this.previewMenu,
    );
  }
  faceViewer(position: THREE.Vector3): void {
    this.controlsView.faceViewer(position);
    this.warning.faceViewer(position);
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
  apply(input: ManipulationPresentation): void {
    const {
      state,
      origin,
      groupId,
      selected,
      target,
      solution,
      plan,
      now,
      robotTitle,
      intent,
    } = input;
    const fresh = intent.fresh;
    this.object.visible = !!state?.available && !!origin;
    if (!this.object.visible || !state?.model || !origin) {
      this.jointFilter.reset();
      this.trajectoryProgress.reset();
      this.previewRequested = false;
      return;
    }
    if (this.modelRenderer.model?.revision !== state.model.revision) {
      this.modelRenderer.rebuild(state.model);
      this.pathKey = "";
      this.jointFilter.reset();
      this.trajectoryProgress.reset();
      for (const stroke of this.ikSegments.values()) stroke.dispose();
      this.ikSegments.clear();
    }
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
    Object.assign(
      all,
      gripperJointValues(model, activeGroup, observed?.gripper),
    );
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
      (selected || state.following === true || intent.dragging === true);
    const offset = intent.targetOffset;
    const displaced = targetVisible && offset;
    const dragging = intent.dragging === true;
    const executing = intent.executing;
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
    const stateText = intent.activity;
    this.controlsView.baseLabel.setFeedback(
      robotTitle,
      stateText,
      `${Math.round(input.speedScale * 100)}%`,
      !fresh ? 0xff9f0a : state.stopped ? 0xff453a : 0x30d158,
    );
    this.modelRenderer.updateGripperBounds(model, measured, groupId, state);
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
      const box = this.modelRenderer.bounds.get(link.name);
      if (!box) continue;
      this.place(box, composePose(rootPose, measured[link.name]), origin);
      const stroke = this.modelRenderer.boundStrokes.get(link.name);
      if (stroke) {
        stroke.object.visible = this.boundsAnimation.progress > 0;
        const center = new THREE.Vector3(
          ...(box.userData.boundsCenter ?? link.bounds!.center),
        ).applyMatrix4(BASIS);
        const size = new THREE.Vector3(
          ...(box.userData.boundsSize ?? link.bounds!.size),
        ).applyMatrix4(BASIS);
        if (box.userData.rootBoundsRotationY) {
          const rotation = new THREE.Matrix4().makeRotationY(
            box.userData.rootBoundsRotationY,
          );
          center.applyMatrix4(rotation);
          size.applyMatrix4(rotation);
        }
        const longest = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
        const axis = longest.indexOf(Math.max(...longest));
        const t = this.boundsAnimation.progress;
        const cross = t * t * (3 - 2 * t);
        const scale = new THREE.Vector3(cross, cross, cross);
        scale.setComponent(axis, 1);
        stroke.object.scale.copy(scale);
        stroke.object.position
          .copy(center)
          .multiply(new THREE.Vector3(1, 1, 1).sub(scale));
        stroke.setStyle(animation.width * 0.65, animation.opacity);
      }
    }
    const activePlan = !state.stopped
      ? ((executing ? state.plan : plan) ?? null)
      : null;
    if (dragging || state.stopped || (!activePlan && !intent.planning))
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
    this.updateIKGuide(
      model,
      filtered,
      solution,
      rootPose,
      origin,
      groupId,
      state,
      !selected && dragging && displaced,
      fresh,
      input.rejection !== null,
    );
    const targetValues = { ...filtered, ...configuration };
    Object.assign(
      targetValues,
      gripperJointValues(model, activeGroup, input.desiredGripper),
    );
    const preview = configuration ? linkPoses(model, targetValues) : null;
    for (const [name, ghost] of this.modelRenderer.ghosts) {
      ghost.visible = selected && displaced && preview === null;
      this.place(ghost, composePose(rootPose, measured[name]), origin);
    }
    for (const [name, ghost] of this.modelRenderer.previewMeshes) {
      ghost.visible = selected && (displaced || playing) && preview !== null;
      if (preview)
        this.place(ghost, composePose(rootPose, preview[name]), origin);
    }
    const group = state.groups?.find((g) => g.id === groupId);
    this.modelRenderer.updateTool(
      model,
      group,
      filtered,
      selected ? input.desiredGripper : null,
      !!observed?.pose && displaced,
    );
    this.handle.collider.userData.interactionEnabled = intent.canManipulate;
    this.path.visible =
      (displaced || (!!activePlan && (playing || executing))) &&
      !!group?.tip_frame;
    this.pathStroke.setStyle(
      WORLD_DASH_STYLE.widthM * 0.65,
      activePlan ? 0.7 : 0.25,
    );
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

    this.controlsView.apply({
      intent,
      selected,
      displaced,
      group,
      observed,
      speedScale: input.speedScale,
      desiredGripper: input.desiredGripper,
      previewRequested: this.previewRequested,
      hoveredAction: this.hoveredAction,
      endEffectorHovered: this.eeHovered,
      handle: this.handle.object,
      now,
      delta: dtOutline,
    });
    if (this.modelRenderer.endEffectorGeometry) {
      this.modelRenderer.endEffectorGeometry.position.copy(
        this.handle.object.position,
      );
      this.modelRenderer.endEffectorGeometry.quaternion.copy(
        this.handle.object.quaternion,
      );
    }
    const failed = !fresh || this.warning.object.visible;
    if (input.rejection) {
      const pose = clientTrackingToWebxrPose(
        odomToClientTrackingPose(input.rejection.pose, origin),
      );
      this.warning.show(
        input.rejection.revision,
        input.rejection.message,
        new THREE.Vector3(...pose.position),
        now,
      );
    }
    this.warning.update(
      this.handle.object.position,
      now,
      intent.dragging === true && input.rejection !== null,
    );
    const handleMaterial = this.handle.collider
      .material as THREE.ShaderMaterial;
    handleMaterial.uniforms?.uCenterColor?.value.set(
      failed ? DIMOS_AR_DESIGN.colors.warning : DIMOS_AR_DESIGN.colors.chrome,
    );
    const copy = `${robotTitle} · ${!fresh ? "Feedback unavailable" : stateText}${this.modelRenderer.assetMessage}`;
    if (this.controlsView.status.text !== copy) {
      this.controlsView.status.text = copy;
      syncText(this.controlsView.status);
    }
  }
  private updateIKGuide(
    model: ManipulationModel,
    measured: Record<string, number>,
    solution: Record<string, number> | null,
    root: ManipulationPose,
    origin: ClientTrackingOrigin,
    groupId: string | null,
    state: ManipulationState,
    visible: boolean,
    fresh: boolean,
    failed: boolean,
  ): void {
    for (const stroke of this.ikSegments.values())
      stroke.object.visible = false;
    if (!visible || !fresh || !solution) return;
    const group = state.groups?.find((g) => g.id === groupId);
    if (!group?.tip_frame) return;
    const current = linkPoses(model, measured),
      proposed = linkPoses(model, { ...measured, ...solution });
    let tip = group.tip_frame;
    for (let count = 0; count < model.joints.length; count++) {
      const joint = model.joints.find((j) => j.child === tip);
      if (!joint) break;
      const a = proposed[joint.parent],
        b = proposed[joint.child];
      const ca = current[joint.parent],
        cb = current[joint.child];
      const distance = Math.max(
        Math.hypot(...a.position.map((v, i) => v - ca.position[i])),
        Math.hypot(...b.position.map((v, i) => v - cb.position[i])),
      );
      const angle =
        2 *
        Math.acos(
          Math.min(
            1,
            Math.abs(
              b.orientation.reduce((n, v, i) => n + v * cb.orientation[i], 0),
            ),
          ),
        );
      const weight = THREE.MathUtils.smoothstep(
        Math.max(distance / 0.08, angle / (Math.PI / 6)),
        0.06,
        1,
      );
      if (Math.hypot(...a.position.map((v, i) => v - b.position[i])) > 0.001) {
        let stroke = this.ikSegments.get(joint.name);
        if (!stroke) {
          stroke = new AdaptiveDashedLineRenderer(
            WORLD_DASH_STYLE.widthM * 0.65,
            WORLD_DASH_STYLE.dashM,
            WORLD_DASH_STYLE.gapM,
            1.3,
          );
          this.ikSegments.set(joint.name, stroke);
          this.object.add(stroke.object);
          stroke.object.userData.environmentDepth = true;
        }
        const convert = (pose: ManipulationPose) =>
          clientTrackingToWebxrPose(
            odomToClientTrackingPose(composePose(root, pose), origin),
          ).position;
        stroke.setSegments([convert(a), convert(b)]);
        stroke.setStyle(WORLD_DASH_STYLE.widthM * 0.65, weight * 0.7);
        const q = solution[joint.name],
          limits = joint.limits;
        const nearLimit =
          limits &&
          q != null &&
          Math.min(q - limits.lower, limits.upper - q) <=
            (limits.upper - limits.lower) * 0.05;
        stroke.object.material.uniforms.uColor.value.setHex(
          failed ? 0xff453a : nearLimit ? 0xff9f0a : 0xffffff,
        );
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
  dispose(): void {
    this.modelRenderer.dispose();
    for (const stroke of this.ikSegments.values()) stroke.dispose();
    this.ikSegments.clear();
    this.controlsView.dispose();
    this.pathStroke.dispose();
    this.handle.dispose();
    this.measuredHandle.dispose();
    this.warning.dispose();
    this.object.removeFromParent();
  }
}
