import { ARM_VISUAL_STYLE, armLinkWeight, armLinkPresentation, ArmMeshFade } from "@dimos-ar-client/manipulation/ManipulationVisuals";
import { manipulationPathOpacity, ManipulationPresentation as PreviewPresentation } from "@dimos-ar-client/manipulation/ManipulationPresentation";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { type ManipulationSnapshot } from "@dimos-ar-client/manipulation/ManipulationInteraction";
import type {
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
import { syncText } from "../presentation/UIFonts";
import {
  clientTrackingToWebxrPose,
} from "../utilities/WebXRCoordinates";
import { ArmJointFilter } from "./ArmJointFilter";
import { gripperJointValues } from "./ArmToolKinematics";
import { ArmTrajectoryProgress } from "./ArmTrajectoryProgress";
import { EndEffectorHandleRenderer } from "./EndEffectorHandleRenderer";
import { ManipulationControlsView } from "./ManipulationControlsView";
import { ManipulationModelRenderer } from "./ManipulationModelRenderer";
import { TargetWarning } from "./TargetWarning";

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
    failedJoints?: string[];
  } | null;
}

export class ManipulationRenderer {
  readonly object = new THREE.Group();
  private readonly modelRenderer = new ManipulationModelRenderer();
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
  private lastFrameTime = 0;
  private readonly meshFade = new ArmMeshFade();
  readonly measuredHandle = new EndEffectorHandleRenderer();
  get previewRequested(): boolean { return this.preview.previewRequested; }
  set previewRequested(value: boolean) {
    if (value && !this.preview.previewRequested) this.preview.togglePreview();
    else this.preview.previewRequested = value;
  }
  handDragging = false;
  private readonly basePosition = new THREE.Vector3();
  private readonly jointFilter = new ArmJointFilter();
  private readonly previewFilter = new ArmJointFilter(0.08);
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
  constructor(private readonly preview = new PreviewPresentation()) {
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
    this.measuredHandle.collider.renderOrder = 51;
    (
      this.measuredHandle.collider.material as THREE.ShaderMaterial
    ).uniforms.uOpacity.value = 0.18;
    const measuredMaterial = this.measuredHandle.collider.material as THREE.ShaderMaterial;
    measuredMaterial.transparent = true; measuredMaterial.depthWrite = false; measuredMaterial.depthTest = false;
    measuredMaterial.uniforms.uFill.value = 0.02;
    measuredMaterial.uniforms.uRim.value = 0.8;
    measuredMaterial.uniforms.uPower.value = 6;
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
    this.object.visible = !!origin && (!!state?.available || this.modelRenderer.model !== null);
    if (!state?.available || !state.model || !origin) {
      this.jointFilter.reset(); this.previewFilter.reset(); this.trajectoryProgress.reset();
      this.previewRequested = false;
      this.meshFade.reset();
      this.measuredHandle.object.visible = false;
      this.handle.object.visible = false; this.handle.collider.userData.interactionEnabled = false;
      this.gripperMenu.visible = this.previewMenu.visible = this.path.visible = false;
      for (const node of this.modelRenderer.previewMeshes.values()) node.visible = false;
      for (const node of this.modelRenderer.ghosts.values()) node.visible = false;
      this.controlsView.baseLabel.setFeedback(robotTitle, "No feedback", `Movement speed ${Math.round(input.speedScale * 100)}%`, 0xff9f0a);
      for (const [key, button] of this.controlsView.buttons) button.setEnabled(key === "estop" ? intent.canStop || intent.canResume : key === "stop" && intent.canStop);
      this.speedSlider.hit.userData.interactionEnabled = false;
      return;
    }
    if (this.modelRenderer.model?.revision !== state.model.revision) {
      this.modelRenderer.rebuild(state.model);
      this.pathKey = "";
      this.jointFilter.reset(); this.previewFilter.reset();
      this.trajectoryProgress.reset();
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
      this.jointFilter.reset(); this.previewFilter.reset();
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
      (selected || state.following === true || intent.dragging === true || intent.finishing === true);
    const offset = intent.targetOffset;
    const displaced = targetVisible && offset;
    const dragging = intent.dragging === true;
    const executing = intent.executing;
    const base = clientTrackingToWebxrPose(
      odomToClientTrackingPose(rootPose, origin),
    );
    this.basePosition.fromArray(base.position);
    this.baseMarker.position.copy(this.basePosition);
    if (selected !== this.selectedBefore) {
      this.pinned = false;
      this.previewRequested = false;
    }
    this.selectedBefore = selected;
    const stateText = intent.activity;
    this.controlsView.baseLabel.setFeedback(
      robotTitle,
      stateText,
      `Movement speed ${Math.round(input.speedScale * 100)}%`,
      !fresh ? 0xff9f0a : state.stopped ? 0xff453a : 0x30d158,
    );
    const dtOutline = Math.max(0, Math.min(0.1, now - this.lastFrameTime));
    this.lastFrameTime = now;
    const activePlan = !state.stopped
      ? ((executing ? state.plan : plan) ?? null)
      : null;
    if (dragging || state.stopped || (!activePlan && !intent.planning))
      this.previewRequested = false;
    const playback = this.preview.sample(activePlan, now);
    const playbackTime = playback.time;
    const playing = playback.playing;
    const configuration =
      playing && activePlan
        ? samplePlan(activePlan, Math.max(0, playbackTime))
        : selected && !input.rejection
          ? activePlan
            ? samplePlan(activePlan, activePlan.duration)
            : solution
          : solution;
    const proposedValues = { ...filtered, ...configuration };
    const targetValues = playing || input.rejection ? proposedValues : this.previewFilter.sample(model, proposedValues, `${model.revision}:${groupId}:${selected}`, now);
    Object.assign(
      targetValues,
      gripperJointValues(model, activeGroup, input.desiredGripper),
    );
    const preview = linkPoses(model, targetValues);
    for (const [name, ghost] of this.modelRenderer.ghosts) {
      ghost.visible = fresh;
      this.place(ghost, composePose(rootPose, (selected || displaced) ? preview[name] : measured[name]), origin);
    }
    this.meshFade.beginFrame(now, `${model.revision}:${groupId}`);
    for (const [name, ghost] of this.modelRenderer.previewMeshes) {
      const style = armLinkPresentation({ selected, hovered: this.hoveredLink !== null, dragging,
        finishing: intent.finishing === true, displaced, playing, weight: armLinkWeight(measured[name], preview[name]),
        failed: input.rejection !== null, failedLink: model.joints.some(j => j.child === name && input.rejection?.failedJoints?.includes(j.name)) });
      const alpha = this.meshFade.sample(name, style.visible ? style.alpha : 0);
      ghost.visible = alpha > 0.0001;
      ghost.traverse(part => {
        if (!(part instanceof THREE.Mesh)) return;
        const material = part.material as THREE.ShaderMaterial;
        if (part.userData.armOutline) {
          material.uniforms.uOpacity.value = ARM_VISUAL_STYLE.opacity * alpha;
          material.uniforms.uWidth.value = style.widthM;
          material.uniforms.uColor.value.setHex(style.color);
        } else {
          material.uniforms.uOpacity.value = alpha;
          material.uniforms.uColor.value.setHex(style.color);
        }
      });
      if (preview)
        this.place(ghost, composePose(rootPose, preview[name]), origin);
    }
    const group = state.groups?.find((g) => g.id === groupId);
    this.handle.collider.userData.interactionEnabled = intent.canManipulate;
    this.path.visible =
      (displaced || (!!activePlan && (playing || executing))) &&
      !!group?.tip_frame;
    this.pathStroke.setStyle(
      WORLD_DASH_STYLE.widthM * 0.65,
      manipulationPathOpacity(intent, !selected && state.following === true && !input.rejection, !!activePlan),
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
    this.measuredHandle.object.visible = !!observed?.pose;
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
      handDragging: this.handDragging,
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
    this.controlsView.dispose();
    this.pathStroke.dispose();
    this.handle.dispose();
    this.measuredHandle.dispose();
    this.warning.dispose();
    this.object.removeFromParent();
  }
}
