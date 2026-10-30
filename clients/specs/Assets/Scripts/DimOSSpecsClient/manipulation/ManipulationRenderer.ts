import { ARM_MATERIAL, configureArmMaterial } from "./ArmMaterial";
import type { ManipulationInputCapture } from "../../DimOSARClient/manipulation/ManipulationInputCapture";
import { RobotBoundsAnimation } from "../../DimOSARClient/presentation/RobotBoundsAnimation";
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, sphereMesh } from "../presentation/WorldMeshRenderer";
import { createIconButton, createText, COLOR_WHITE, type IconButtonResult } from "../presentation/UIKit";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { odomToClientTrackingPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { composePose, linkPoses, samplePlan, visualJointValues, manipulationPlanPath, manipulationToolLinks, inversePose } from "../../DimOSARClient/manipulation/ModelKinematics";
import { manipulationControls } from "../../DimOSARClient/manipulation/ManipulationPresentation";
import type { ManipulationController, ManipulationControlAction } from "../../DimOSARClient/manipulation/ManipulationController";
import type { ManipulationPose, ManipulationState } from "../../DimOSARClient/manipulation/ManipulationTypes";
import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { OPENYAM_MESH } from "./OpenYAMMesh";

export class ManipulationRenderer {
  readonly object: SceneObject;
  readonly handle: SceneObject;
  readonly panel: SceneObject;
  private readonly gripper: IconButtonResult;
  private readonly label: Text;
  private readonly buttons = new Map<string, IconButtonResult>();
  private readonly bounds = new Map<string, AdaptiveStrokeRenderer>();
  private readonly toolMeshes = new Map<string, WorldMeshRenderer>();
  private readonly meshes = new Map<string, WorldMeshRenderer>();
  private readonly path: AdaptiveStrokeRenderer;
  private readonly measured: WorldMeshRenderer;
  private readonly modelSubscriptions: (() => void)[] = [];
  private readonly subscriptions: (() => void)[] = [];
  private modelRevision = "";
  private pathKey = "";
  private pathPoints: Vec3[] = [];
  private readonly hoverSources = new Set<string>();
  private readonly boundsAnimation = new RobotBoundsAnimation();
  private lastTime = 0;
  private rejectionRevision = -1;
  private rejectionUntil = 0;
  private readonly warning: Text;
  private selected = false;
  private readonly speed: Slider;
  private syncingSpeed = false;

  constructor(parent: SceneObject, private readonly core: ManipulationController,
    private readonly select: () => void, private readonly stop: () => void, capture: ManipulationInputCapture) {
    this.object = global.scene.createSceneObject("Manipulation"); this.object.setParent(parent);
    this.handle = global.scene.createSceneObject("EndEffectorHandle"); this.handle.setParent(this.object);
    const sphere = new WorldMeshRenderer(this.handle, "EndEffectorSphere");
    const geometry = sphereMesh(1.8, 16, 12);
    sphere.triangles(geometry.positions, geometry.indices, [0.8, 0.9, 1, 0.7], undefined, geometry.normals);
    const collider = this.handle.createComponent("Physics.ColliderComponent") as ColliderComponent;
    collider.shape = Shape.createSphereShape(); (collider.shape as SphereShape).radius = 2.2;
    this.handle.createComponent(Interactable.getTypeName());
    this.measured = new WorldMeshRenderer(this.object, "MeasuredEndEffector");
    this.measured.triangles(geometry.positions, geometry.indices, [1, 1, 1, 0.35], undefined, geometry.normals);
    this.path = new AdaptiveStrokeRenderer(this.object, "ManipulationPath");
    this.panel = global.scene.createSceneObject("ManipulationMenu"); this.panel.setParent(this.object);
    this.panel.getTransform().setLocalScale(new vec3(0.7, 0.7, 0.7));
    this.label = createText({ parent: this.panel, name: "ArmStatus", fontSize: 42, color: COLOR_WHITE,
      position: new vec3(0, 4, 0), horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(-18, 18, -3, 3) });
    this.warning = createText({ parent: this.object, name: "RejectedTarget", fontSize: 36, color: new vec4(1, 0.65, 0, 1),
      position: vec3.zero(), horizontalAlignment: HorizontalAlignment.Center, worldSpaceRect: Rect.create(-20, 20, -3, 3) });
    const add = (key: string, label: string, action: () => void, y: number) => {
      const button = createIconButton(this.panel, key, label, 15, 3.2, new vec3(0, y, 0));
      this.subscriptions.push(button.button.onTriggerDown.add(() => { if (this.controlsEnabled && !button.button.inactive) action(); })); this.buttons.set(key, button);
    };
    add("select", "Select arm", select, 0);
    add("plan", "Preview", () => core.action("plan"), -4);
    add("execute", "Execute", () => core.action(manipulationControls(this.state, core.interaction, this.selected).executeAction), -8);
    add("reset", "Reset", () => core.action("reset"), -12);
    add("resume", "Resume", () => core.action("resume"), -16);
    add("estop", "Emergency Stop", stop, -20);
    add("group", "Next group", () => core.action("group"), -24);
    const speedRoot = global.scene.createSceneObject("ManipulationSpeed"); speedRoot.setParent(this.panel);
    speedRoot.getTransform().setLocalPosition(new vec3(0, -28, 0));
    this.speed = speedRoot.createComponent(Slider.getTypeName()) as Slider;
    this.speed.size = new vec3(15, 1.5, 0.5); this.speed.knobSize = new vec2(2, 2);
    this.speed.currentValue = (core.interaction.speedScale - 0.05) / 0.95;
    this.subscriptions.push(this.speed.onValueChange.add(value => {
      if (!this.syncingSpeed) core.interaction.setSpeedScale(0.05 + Math.max(0, Math.min(1, value)) * 0.95);
    }));
    this.gripper = createIconButton(this.object, "Gripper", "Open", 9.5, 3.2, vec3.zero());
    this.subscriptions.push(this.gripper.button.interactable.onTriggerStart.add(event => {
      if (this.controlsEnabled && manipulationControls(this.state, core.interaction, this.selected).canGripper &&
          capture.pressGripper(String(event.interactor.inputType))) core.action("gripper");
    }));
    this.subscriptions.push(this.gripper.button.interactable.onTriggerEnd.add(event => capture.releaseGripper(String(event.interactor.inputType))));
  }
  private state: ManipulationState | null | undefined;
  private controlsEnabled = false;
  ownsBounds(object: SceneObject): boolean {
    for (const stroke of this.bounds.values()) if (object.getParent() === stroke.object) return true;
    return false;
  }
  ownsHandle(object: SceneObject): boolean { return object === this.handle; }
  apply(state: ManipulationState | null | undefined, origin: ClientTrackingOrigin | null,
    selected: boolean, enabled: boolean, now: number, camera: SceneObject, title: string): void {
    this.state = state; this.selected = selected; this.controlsEnabled = enabled;
    this.object.enabled = !!state?.available && !!origin && enabled;
    if (!this.object.enabled || !state?.model || !origin) return;
    const model = state.model, interaction = this.core.interaction;
    const group = state.groups?.find(g => g.id === interaction.groupId);
    const observed = state.observations?.[interaction.groupId ?? ""];
    const dt = this.lastTime ? Math.max(0, Math.min(0.1, now - this.lastTime)) : 1 / 60; this.lastTime = now;
    const animation = this.boundsAnimation.update(selected, this.hoverSources.size > 0, dt);
    const controls = manipulationControls(state, interaction, selected);
    const displayedPose = (selected || state.following || interaction.following) && interaction.target ? interaction.target : observed?.pose;
    const root = state.root_pose ?? { position: [0, 0, 0] as Vec3, orientation: [0, 0, 0, 1] as [number, number, number, number] };
    const opening = selected ? interaction.desiredGripper ?? observed?.gripper : observed?.gripper;
    const all = visualJointValues(model, Object.values(state.observations ?? {}), group?.joint_names ?? [], observed?.gripper);
    const targetValues = visualJointValues(model, Object.values(state.observations ?? {}), group?.joint_names ?? [], opening);
    const plan = interaction.plan ?? (["accepted", "executing"].includes(state.execution ?? "") ? state.plan : null) ?? null;
    const playback = this.core.presentation.sample(plan, now);
    const configuration = selected ? plan ? samplePlan(plan, playback.time) : interaction.solution : null;
    const poses = linkPoses(model, { ...targetValues, ...configuration });
    const measuredPoses = linkPoses(model, all);
    const tool = group?.tip_frame ? manipulationToolLinks(model, group.tip_frame) : null;
    if (this.modelRevision !== model.revision) {
      for (const unsubscribe of this.modelSubscriptions) unsubscribe(); this.modelSubscriptions.length = 0;
      for (const mesh of this.toolMeshes.values()) mesh.destroy(); this.toolMeshes.clear();
      this.hoverSources.clear();
      for (const mesh of this.meshes.values()) mesh.destroy(); this.meshes.clear();
      for (const stroke of this.bounds.values()) stroke.destroy(); this.bounds.clear();
      this.modelRevision = model.revision;
      for (const link of model.links) {
        if (link.bounds) {
          const stroke = new AdaptiveStrokeRenderer(this.object, `Bounds_${link.name}`); this.bounds.set(link.name, stroke);
          const pickRoot = global.scene.createSceneObject(`Pick_${link.name}`); pickRoot.setParent(stroke.object);
          pickRoot.getTransform().setLocalPosition(new vec3(...clientTrackingToSpecsPoint(link.bounds.center)));
          const pick = pickRoot.createComponent("Physics.ColliderComponent") as ColliderComponent;
          pick.shape = Shape.createBoxShape(); (pick.shape as BoxShape).size = new vec3(...clientTrackingToSpecsPoint(link.bounds.size).map(Math.abs) as [number, number, number]);
          const hit = pickRoot.createComponent(Interactable.getTypeName()) as Interactable;
          this.modelSubscriptions.push(hit.onTriggerStart.add(() => this.select()));
          this.modelSubscriptions.push(hit.onHoverEnter.add(event => this.hoverSources.add(`${link.name}:${event.interactor.inputType}`)));
          this.modelSubscriptions.push(hit.onHoverExit.add(event => this.hoverSources.delete(`${link.name}:${event.interactor.inputType}`)));
        }
        const data = OPENYAM_MESH.links[link.name];
        if (data && model.visual_signature === OPENYAM_MESH.signature) {
          const mesh = new WorldMeshRenderer(this.object, `Arm_${link.name}`, ARM_MATERIAL);
          const positions: number[] = [], normals: number[] = [];
          for (let i = 0; i < data.positions.length; i += 3) {
            let p: Vec3 = [data.positions[i], data.positions[i + 1], data.positions[i + 2]];
            if (link.name === model.root) p = [-p[1], p[0], p[2]];
            positions.push(...clientTrackingToSpecsPoint(p));
            let n: Vec3 = [data.normals[i], data.normals[i + 1], data.normals[i + 2]];
            if (link.name === model.root) n = [-n[1], n[0], n[2]];
            normals.push(...clientTrackingToSpecsPoint(n).map(value => value / 100));
          }
          configureArmMaterial(mesh.material);
          mesh.triangles(positions, data.indices, [203 / 255, 217 / 255, 223 / 255, 1], undefined, normals); this.meshes.set(link.name, mesh);
          const toolMesh = new WorldMeshRenderer(this.object, `Tool_${link.name}`, ARM_MATERIAL);
          configureArmMaterial(toolMesh.material, true);
          toolMesh.triangles(positions, data.indices, [203 / 255, 217 / 255, 223 / 255, 1], undefined, normals); this.toolMeshes.set(link.name, toolMesh);
        }
      }
    }
    for (const link of model.links) {
      const pose = composePose(root, measuredPoses[link.name]);
      const toolMesh = this.toolMeshes.get(link.name);
      if (toolMesh) {
        toolMesh.object.enabled = !!observed?.pose && !!tool?.links.has(link.name);
        if (toolMesh.object.enabled && group?.tip_frame) {
          const relative = composePose(inversePose(measuredPoses[group.tip_frame]), measuredPoses[link.name]);
          this.place(toolMesh.object, composePose(displayedPose!, relative), origin);
        }
      }
      const mesh = this.meshes.get(link.name); if (mesh) { mesh.object.enabled = selected; this.place(mesh.object, composePose(root, poses[link.name]), origin); }
      const stroke = this.bounds.get(link.name);
      if (stroke && link.bounds) {
        const half = link.bounds.size.map(v => v / 2), c = link.bounds.center;
        const corners: Vec3[] = [];
        for (let i = 0; i < 8; i++) corners.push(clientTrackingToSpecsPoint(c.map((v, axis) => v + ((i & (1 << axis)) ? 1 : -1) * half[axis] * (axis === 2 ? animation.vertical : animation.horizontal)) as Vec3));
        const lines: Vec3[] = [];
        for (let i = 0; i < 8; i++) for (let axis = 0; axis < 3; axis++) if (!(i & (1 << axis))) lines.push(corners[i], corners[i | (1 << axis)]);
        stroke.segments(lines, animation.width * 100, animation.opacity); this.place(stroke.object, pose, origin);
      }
    }
    this.handle.enabled = !!observed?.pose && interaction.feedbackFresh && !state.stopped;
    if (observed?.pose) {
      this.place(this.handle, displayedPose!, origin);
      this.place(this.measured.object, observed.pose, origin); this.measured.object.enabled = selected;
      const p = this.handle.getTransform().getWorldPosition();
      this.gripper.sceneObject.getTransform().setWorldPosition(p.add(new vec3(0, 8, 0)));
      this.gripper.sceneObject.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    }
    this.gripper.sceneObject.enabled = !!group?.has_gripper && !!observed?.pose && !state.stopped;
    this.gripper.labelText.text = controls.gripperLabel;
    this.gripper.button.inactive = !controls.canGripper;
    const base = clientTrackingToSpecsPose(odomToClientTrackingPose(root, origin));
    this.panel.getTransform().setWorldPosition(new vec3(...base.position).add(new vec3(10, 8, 0)));
    this.panel.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    this.syncingSpeed = true; this.speed.currentValue = (interaction.speedScale - 0.05) / 0.95; this.syncingSpeed = false;
    this.speed.enabled = interaction.feedbackFresh;
    this.label.text = `${title} · ${controls.status} · ${Math.round(interaction.speedScale * 100)}%` +
      (model.visual_signature !== OPENYAM_MESH.signature ? " · Preview mesh unavailable" : "");
    for (const [key, button] of this.buttons) {
      button.sceneObject.enabled = key === "plan" || key === "execute" ? selected && !state.stopped : key === "resume" ? !!state.stopped : key === "group" ? (state.groups?.length ?? 0) > 1 : true;
      button.button.inactive = !(key === "estop" || key === "select" || interaction.feedbackFresh);
    }
    const rows = [...(selected && !state.stopped ? ["plan", "execute"] : []),
      ...(state.stopped ? ["resume"] : []), "select", "reset", "estop",
      ...((state.groups?.length ?? 0) > 1 ? ["group"] : [])];
    rows.forEach((key, index) => this.buttons.get(key)!.sceneObject.getTransform().setLocalPosition(new vec3(0, -index * 4, 0)));
    this.speed.getSceneObject().getTransform().setLocalPosition(new vec3(0, -rows.length * 4, 0));
    this.buttons.get("execute")!.labelText.text = controls.executeLabel;
    this.buttons.get("execute")!.button.inactive = !controls.canExecute;
    this.buttons.get("plan")!.button.inactive = !controls.canPreview;
    this.buttons.get("select")!.labelText.text = selected ? "Deselect arm" : "Select arm";
    const points: Vec3[] = [];
    if (selected && plan && group?.tip_frame) {
      const key = JSON.stringify([plan.plan_id, model.revision, group.tip_frame, origin, root]);
      if (key !== this.pathKey) {
        this.pathKey = key;
        this.pathPoints = manipulationPlanPath(model, plan, group.tip_frame, all, root).map(position =>
          clientTrackingToSpecsPose(odomToClientTrackingPose({ position, orientation: [0, 0, 0, 1] }, origin)).position);
      }
      points.push(...this.pathPoints);
    } else if (selected && interaction.target && observed?.pose) {
      points.push(clientTrackingToSpecsPose(odomToClientTrackingPose(observed.pose, origin)).position,
        clientTrackingToSpecsPose(odomToClientTrackingPose(interaction.target, origin)).position);
    }
    if (!plan) this.pathKey = "";
    this.path.segments(points.slice(0, -1).flatMap((p, i) => [p, points[i + 1]]), 0.275, 0.8, 1.2, 1, true);
    if (interaction.rejection && interaction.rejection.revision !== this.rejectionRevision) {
      this.rejectionRevision = interaction.rejection.revision; this.rejectionUntil = now + 1.5;
      this.warning.text = interaction.rejection.message; this.place(this.warning.getSceneObject(), interaction.rejection.pose, origin);
    }
    this.warning.getSceneObject().enabled = now < this.rejectionUntil;
    this.warning.getSceneObject().getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
  }
  private place(object: SceneObject, pose: ManipulationPose, origin: ClientTrackingOrigin): void {
    const p = clientTrackingToSpecsPose(odomToClientTrackingPose(pose, origin));
    object.getTransform().setWorldPosition(new vec3(...p.position));
    object.getTransform().setWorldRotation(new quat(p.orientation[3], p.orientation[0], p.orientation[1], p.orientation[2]));
  }
  dispose(): void { for (const unsubscribe of this.modelSubscriptions) unsubscribe(); for (const unsubscribe of this.subscriptions) unsubscribe(); this.object.destroy(); }
}
