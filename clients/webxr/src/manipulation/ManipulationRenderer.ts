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
export class ManipulationRenderer {
  readonly object = new THREE.Group();
  readonly handle = new EndEffectorHandleRenderer();
  private readonly pathStroke = new AdaptiveDashedLineRenderer();
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
  working = false;
  desiredGripper: number | null = null;
  private readonly basePosition = new THREE.Vector3();
  private readonly displayedTarget = new THREE.Object3D();
  private displayInitialized = false;
  private displayTime = 0;
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
    this.object.add(this.measuredHandle.object);
    this.object.add(
      this.path,
      this.handle.object,
      this.controls,
      this.baseMarker,
      this.gripperMenu,
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
    addButton("plan", this.controls, "Preview", "plan", -0.069, 0.031, 0.095);
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
    addButton(
      "panel-estop",
      this.controls,
      "Emergency Stop",
      "estop",
      0,
      -0.009,
      0.242,
      "danger",
    );
    addButton(
      "estop",
      this.baseMarker,
      "E-stop",
      "estop",
      -0.055,
      -0.055,
      0.1,
      "danger",
    );
    addButton("reset", this.baseMarker, "Reset", "reset", 0.055, -0.055, 0.1);
    addButton(
      "resume",
      this.baseMarker,
      "Resume",
      "resume",
      -0.055,
      -0.095,
      0.1,
      "primary",
    );
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
    for (const key of ["estop", "reset", "resume"]) {
      this.controls.add(this.buttons.get(key)!);
    }
    this.buttons.get("panel-estop")!.visible = false;
  }
  speedScale = 0.2;
  faceViewer(position: THREE.Vector3): void {

    this.baseMarker.lookAt(position);
    this.warning.faceViewer(position);
    this.gripperMenu.lookAt(position);
  }
  owns(object: THREE.Object3D): boolean {
    return (
      object === this.handle.collider ||
      !!object.userData.manipulationLink ||
      !!object.userData.manipulationPanel ||
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
  ): void {
    this.object.visible = !!state?.available && !!origin;
    if (!this.object.visible || !state?.model || !origin) return;
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
    if (observed?.gripper != null)
      for (const joint of model.joints) {
        if (
          joint.kind === "prismatic" &&
          joint.limits &&
          !activeGroup?.joint_names.includes(joint.name)
        )
          all[joint.name] =
            joint.limits.lower +
            (joint.limits.upper - joint.limits.lower) * observed.gripper;
      }
    const measured = linkPoses(model, all);
    const base = clientTrackingToWebxrPose(
      odomToClientTrackingPose(rootPose, origin),
    );
    this.basePosition.fromArray(base.position);
    this.baseMarker.position
      .copy(this.basePosition)
      .add(new THREE.Vector3(0.1, 0.08, 0));
    if (selected !== this.selectedBefore) {
      this.pinned = false;
      this.displayInitialized = false;
      this.previewRequested = false;
    }
    this.selectedBefore = selected;
    const stateText = state.stopped
      ? "Stopped"
      : state.following
        ? "Following"
        : /Returning to zero|Planning|Executing/.test(message)
          ? message
          : state.execution === "idle"
            ? "Idle"
            : state.execution || "Idle";
    this.baseLabel.setFeedback(
      robotTitle,
      `${stateText} · ${Math.round(this.speedScale * 100)}%`,
      "",
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
        stroke.object.scale.set(
          animation.horizontal,
          animation.vertical,
          animation.horizontal,
        );
        const center = new THREE.Vector3(...(box.userData.boundsCenter ?? link.bounds!.center)).applyMatrix4(BASIS);
        stroke.object.position.copy(center).multiply(new THREE.Vector3(
          1 - animation.horizontal, 1 - animation.vertical, 1 - animation.horizontal,
        ));
        stroke.setStyle(animation.width, animation.opacity);
      }
    }
    const activePlan =
      plan ??
      (["accepted", "executing"].includes(state.execution ?? "")
        ? state.plan
        : null) ??
      null;
    if (activePlan?.plan_id !== this.previewId) {
      this.previewId = activePlan?.plan_id ?? null;
      this.previewStarted = now;
    }
    if (this.previewRequested && !this.previewWasRequested) this.previewStarted = now;
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
          ? (activePlan ? samplePlan(activePlan, activePlan.duration) : solution)
          : null;
    const targetValues = { ...all, ...configuration };
    for (const joint of model.joints)
      if (joint.kind === "prismatic" && joint.limits && this.desiredGripper != null &&
          !activeGroup?.joint_names.includes(joint.name))
        targetValues[joint.name] = joint.limits.lower +
          (joint.limits.upper - joint.limits.lower) * this.desiredGripper;
    const preview = configuration
      ? linkPoses(model, targetValues)
      : null;
    for (const [name, ghost] of this.ghosts) {
      ghost.visible = selected && preview === null;
      this.place(ghost, composePose(rootPose, measured[name]), origin);
    }
    for (const [name, ghost] of this.previewMeshes) {
      ghost.visible = selected && preview !== null;
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
      const values = { ...all };
      const opening = selected
        ? (this.desiredGripper ?? observed?.gripper)
        : observed?.gripper;
      for (const j of model.joints)
        if (
          j.kind === "prismatic" &&
          j.limits &&
          !group.joint_names.includes(j.name) &&
          opening != null
        )
          values[j.name] =
            j.limits.lower + (j.limits.upper - j.limits.lower) * opening;
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
    if (this.eeGeometry) this.eeGeometry.visible = !!observed?.pose;
    this.handle.collider.userData.interactionEnabled = fresh && !state.stopped;
    this.path.visible =
      selected && (!!activePlan || !!target) && !!group?.tip_frame;
    if (!activePlan && target && observed?.pose) {
      const start = clientTrackingToWebxrPose(
        odomToClientTrackingPose(observed.pose, origin),
      );
      const end = clientTrackingToWebxrPose(
        odomToClientTrackingPose(target, origin),
      );
      this.pathStroke.setSegments([start.position, end.position], true);
      this.pathKey = "";
    }
    const pathKey =
      activePlan && group?.tip_frame
        ? JSON.stringify([
            activePlan.plan_id,
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
          ...samplePlan(activePlan, (activePlan.duration * i) / count),
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
    this.measuredHandle.object.visible = selected && !!observed?.pose;
    if (selected && observed?.pose)
      this.place(this.measuredHandle.object, observed.pose, origin);
    (
      this.handle.collider.material as THREE.ShaderMaterial
    ).uniforms.uOpacity.value = selected ? 0.42 : 1;
    this.handle.object.visible = !!observed?.pose;
    if (observed?.pose)
      this.place(
        this.handle.object,
        (selected || state.following) && target ? target : observed.pose,
        origin,
      );
    this.controls.visible = true;
    this.buttons.get("plan")!.visible = selected && !state.stopped;
    this.buttons.get("execute")!.visible = selected && !state.stopped;
    this.buttons.get("panel-estop")!.visible = false;
    this.buttons.get("estop")!.position.set(0, -0.08, 0.008);
    this.buttons.get("reset")!.position.set(0, -0.04, 0.008);
    this.buttons.get("resume")!.position.set(0, 0, 0.008);
    this.status.visible = false;
    const rows = [
      ...(selected && !state.stopped ? ["plan", "execute"] : []),
      ...(state.stopped ? ["resume"] : []), "reset", "estop",
    ];
    const menuHeight = rows.length * 0.04 + 0.016;
    this.menuHeight.request(menuHeight);
    this.menuHeight.tick(dtOutline);
    this.menuPlate.resize(0.16, this.menuHeight.height, 0.016);
    this.menuPlate.position.y = -this.menuHeight.height / 2;
    rows.forEach((key, index) => {
      const button = this.buttons.get(key)!;
      button.position.set(0, -0.028 - index * 0.04, 0.008);
      button.visible = true;
    });
    const primary = this.buttons.get("execute")!;
    const primaryAction = this.working ? "cancel" : "execute";
    if (primary.userData.mode !== primaryAction) {
      primary.userData.mode = primaryAction;
      primary.setText(this.working ? "Cancel" : "Execute");
      primary.setSurface(this.working ? "danger" : "primary");
      primary.traverse((node) => {
        node.userData.manipulationAction = primaryAction;
      });
    }
    for (const [key, button] of this.buttons) {
      button.setEnabled(["estop", "panel-estop"].includes(key) || fresh);
      if (key === "execute")
        button.setEnabled(this.working || (fresh && target !== null));
      if (key === "resume") button.visible = state.stopped === true;
      if (key === "plan") {
        button.setActive(this.previewRequested);
        button.setEnabled(fresh && target !== null && !this.working);
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
    if (this.handle.object.visible) {
      const desired = this.handle.object.position.clone();
      const rotation = this.handle.object.quaternion.clone();
      if (!this.displayInitialized) {
        this.displayedTarget.position.copy(desired);
        this.displayedTarget.quaternion.copy(rotation);
        this.displayInitialized = true;
      }
      const dt = this.displayTime
        ? Math.max(0, Math.min(0.1, now - this.displayTime))
        : 1 / 60;
      this.displayTime = now;
      const smoothing = 1 - Math.exp(-14 * dt);
      this.displayedTarget.position.lerp(desired, smoothing);
      this.displayedTarget.quaternion.slerp(rotation, smoothing);
      this.handle.object.position.copy(this.displayedTarget.position);
      this.handle.object.quaternion.copy(this.displayedTarget.quaternion);
      if (this.eeHovered) this.hoverUntil = now + 0.3;
      this.hoverProgress +=
        ((now < this.hoverUntil ? 1 : 0) - this.hoverProgress) * smoothing;
      this.gripperMenu.visible =
        group?.has_gripper === true && this.hoverProgress > 0.01;
      this.gripperMenu.scale.setScalar(Math.max(0.01, this.hoverProgress));
      this.gripperMenu.position
        .copy(this.handle.object.position)
        .add(new THREE.Vector3(0, 0.055 + this.hoverProgress * 0.025, 0));
      if (this.eeGeometry) {
        this.eeGeometry.position.copy(this.handle.object.position);
        this.eeGeometry.quaternion.copy(this.handle.object.quaternion);
      }
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
    this.warning.update(this.handle.object.position, now);
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
    const group = state.groups?.find(g => g.id === groupId);
    if (!group?.tip_frame || !group.has_gripper) return;
    let root = group.tip_frame;
    let parent = model.joints.find(j => j.child === root);
    while (parent?.kind === "fixed") {
      root = parent.parent;
      parent = model.joints.find(j => j.child === root);
    }
    const links = new Set([root]);
    for (let pass = 0; pass < model.joints.length; pass++)
      for (const joint of model.joints)
        if (links.has(joint.parent)) links.add(joint.child);
    const matrix = (pose: ManipulationPose) => new THREE.Matrix4().compose(
      new THREE.Vector3(...pose.position), new THREE.Quaternion(...pose.orientation),
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
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
        union.expandByPoint(new THREE.Vector3(x, y, z).multiply(half).add(center).applyMatrix4(transform));
      if (link.name !== root) {
        const box = this.bounds.get(link.name);
        if (box) box.visible = false;
      }
    }
    if (union.isEmpty()) return;
    const box = this.bounds.get(root);
    const stroke = this.boundStrokes.get(root);
    const rootLink = model.links.find(l => l.name === root);
    if (!box || !stroke || !rootLink) return;
    const center = union.getCenter(new THREE.Vector3());
    const size = union.getSize(new THREE.Vector3());
    const key = [...center.toArray(), ...size.toArray()].map(v => v.toFixed(5)).join(",");
    if (box.userData.gripperBoundsKey === key) return;
    box.userData.gripperBoundsKey = key;
    box.userData.boundsCenter = center.toArray();
    const geometry = new THREE.BoxGeometry(...size.toArray());
    geometry.translate(...center.toArray());
    geometry.applyMatrix4(BASIS);
    const collider = box.children.find(c => c instanceof THREE.Mesh) as THREE.Mesh;
    collider.geometry.dispose(); collider.geometry = geometry;
    const edges = new THREE.EdgesGeometry(geometry);
    const positions = edges.getAttribute("position");
    stroke.setSegments(Array.from({length: positions.count}, (_, i) =>
      [positions.getX(i), positions.getY(i), positions.getZ(i)] as Vec3));
    edges.dispose();
  }
  private rebuild(model: ManipulationModel): void {
    this.clearModel();
    this.model = model;
    for (const link of model.links) {
      if (!link.bounds) continue;
      const group = new THREE.Group(),
        geometry = new THREE.BoxGeometry(...link.bounds.size);
      geometry.translate(...link.bounds.center);
      geometry.applyMatrix4(BASIS);

      const edges = new THREE.EdgesGeometry(geometry),
        positions = edges.getAttribute("position");
      const stroke = new AdaptiveDashedLineRenderer();
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
                if (!part.geometry.getAttribute("normal")) part.geometry.computeVertexNormals();
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
    this.assetGeneration++;
    this.pathKey = "";
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
