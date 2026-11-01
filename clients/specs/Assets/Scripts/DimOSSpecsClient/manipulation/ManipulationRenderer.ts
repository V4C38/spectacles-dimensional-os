import { manipulationMenuRows, manipulationButtonEnabled, endEffectorAction, manipulationPathOpacity } from "../../DimOSARClient/manipulation/ManipulationPresentation";
import { PanelHeightAnimation } from "../../DimOSARClient/presentation/PanelHeightAnimation";
import { ArmJointFilter } from "../../DimOSARClient/manipulation/ArmJointFilter";
import { ArmTrajectoryProgress } from "../../DimOSARClient/manipulation/ArmTrajectoryProgress";
import { gripperJointValues } from "../../DimOSARClient/manipulation/ArmToolKinematics";
import { ARM_VISUAL_STYLE as STYLE, armShapeEdges, armLinkWeight, armLinkPresentation, ArmMeshFade } from "../../DimOSARClient/manipulation/ManipulationVisuals";
import { ARM_MATERIAL, configureArmMaterial } from "./ArmMaterial";
import type { ManipulationInputCapture } from "../../DimOSARClient/manipulation/ManipulationInputCapture";
import { WORLD_DASH_STYLE, ROBOT_LABEL_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, sphereMesh } from "../presentation/WorldMeshRenderer";
import { createIconButton, createText, createRobotLabelText, createPanelSurface, setButtonStyle, uiMaterialLayer, SnapOS2Styles, COLOR_WHITE, type IconButtonResult } from "../presentation/UIKit";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { odomToClientTrackingPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { composePose, linkPoses, samplePlan, manipulationPlanPath } from "../../DimOSARClient/manipulation/ModelKinematics";
import type { ManipulationController } from "../../DimOSARClient/manipulation/ManipulationController";
import type { ManipulationPose, ManipulationState } from "../../DimOSARClient/manipulation/ManipulationTypes";
import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { OPENYAM_MESH } from "./OpenYAMMesh";

export class ManipulationRenderer {
  readonly object: SceneObject;
  readonly handle: SceneObject;
  readonly panel: SceneObject;
  private readonly base: SceneObject;
  private readonly previewMenu: SceneObject;
  private readonly gripper: IconButtonResult;
  private readonly label: Text;
  private readonly nameLabel: Text;
  private readonly activityLabel: Text;
  private readonly sphere: WorldMeshRenderer;
  private readonly speedLabel: Text;
  private readonly warning: Text;
  private readonly buttons = new Map<string, IconButtonResult>();
  private readonly picks = new Map<string, SceneObject>();
  private readonly meshes = new Map<string, WorldMeshRenderer>();
  private readonly edges = new Map<string, { stroke: AdaptiveStrokeRenderer; points: Vec3[] }>();
  private readonly path: AdaptiveStrokeRenderer;
  private readonly measured: WorldMeshRenderer;
  private readonly subscriptions: (() => void)[] = [];
  private readonly modelSubscriptions: (() => void)[] = [];
  private readonly hoverSources = new Set<string>();
  private readonly handleHover = new Set<string>();
  private readonly jointFilter = new ArmJointFilter();
  private readonly previewFilter = new ArmJointFilter(0.08);
  private readonly progress = new ArmTrajectoryProgress();
  private readonly speed: Slider;
  private readonly plate: ReturnType<typeof createPanelSurface>;
  private readonly menuHeight = new PanelHeightAnimation();
  private syncingSpeed = false;
  private modelRevision = "";
  private context = "";
  private lastOrigin: ClientTrackingOrigin | null = null;
  private pathKey = "";
  private pathPoints: Vec3[] = [];
  private lastTime = 0;
  private hoverUntil = 0;
  private hoverProgress = 0;
  private state: ManipulationState | null | undefined;
  private controlsEnabled = false;
  private readonly meshFade = new ArmMeshFade();
  private selected = false;

  constructor(parent: SceneObject, private readonly core: ManipulationController,
    stop: () => void, private readonly capture: ManipulationInputCapture) {
    this.object = this.node(parent, "Manipulation");
    this.handle = this.node(this.object, "EndEffectorHandle");
    const geometry = sphereMesh(1.8, 20, 16);
    this.sphere = new WorldMeshRenderer(this.handle, "EndEffectorSphere", ARM_MATERIAL);
    configureArmMaterial(this.sphere.material);
    (this.sphere.material.mainPass as Pass & { fill: number }).fill = 1;
    this.sphere.triangles(geometry.positions, geometry.indices, [0.82, 0.82, 0.82, 1], undefined, geometry.normals);
    const collider = this.handle.createComponent("Physics.ColliderComponent") as ColliderComponent;
    collider.shape = Shape.createSphereShape(); (collider.shape as SphereShape).radius = 2.2;
    const hit = this.handle.createComponent(Interactable.getTypeName()) as Interactable;
    hit.keepHoverOnTrigger = true; hit.useFilteredPinch = true; hit.enableInstantDrag = true;
    this.subscriptions.push(hit.onHoverEnter.add(e => this.handleHover.add(String(e.interactor.inputType))));
    this.subscriptions.push(hit.onHoverExit.add(e => this.handleHover.delete(String(e.interactor.inputType))));
    this.measured = new WorldMeshRenderer(this.object, "MeasuredEndEffector", ARM_MATERIAL);
    uiMaterialLayer(this.measured.visual, 51);
    const pass = this.measured.material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number };
    pass.fill = 0.02 * 0.18; pass.edgeOpacity = 0.82 * 0.18; pass.power = 6;
    const measuredGeometry = sphereMesh(1.8 * 0.65, 20, 16);
    this.measured.triangles(measuredGeometry.positions, measuredGeometry.indices, [1, 1, 1, 1], undefined, measuredGeometry.normals);
    this.path = new AdaptiveStrokeRenderer(this.object, "ManipulationPath");
    this.base = this.node(this.object, "ArmBaseMarker");
    const orb = new WorldMeshRenderer(this.base, "ArmBaseDot");
    orb.triangles(geometry.positions, geometry.indices, [0.8, 0.9, 1, 0.7], undefined, geometry.normals);
    const baseCollider = this.base.createComponent("Physics.ColliderComponent") as ColliderComponent;
    baseCollider.shape = Shape.createSphereShape(); (baseCollider.shape as SphereShape).radius = 2.2;
    const baseHit = this.base.createComponent(Interactable.getTypeName()) as Interactable;
    this.subscriptions.push(baseHit.onHoverEnter.add(e => this.hoverSources.add(`base:${e.interactor.inputType}`)));
    this.subscriptions.push(baseHit.onHoverExit.add(e => this.hoverSources.delete(`base:${e.interactor.inputType}`)));
    const labels = this.node(this.base, "ArmMarkerLabel");
    labels.getTransform().setLocalPosition(new vec3(0, 5, 0)); labels.getTransform().setLocalScale(new vec3(0.75, 0.75, 0.75));
    const style = ROBOT_LABEL_STYLE;
    this.nameLabel = createRobotLabelText(labels, "ArmTitle", style.title.emM, style.title.xM, style.title.yM, style.title.widthM, true, COLOR_WHITE, 21);
    this.activityLabel = createRobotLabelText(labels, "ArmActivity", style.activity.emM, 0, style.activity.yM, style.activity.widthM, false, COLOR_WHITE, 22);
    this.label = createRobotLabelText(labels, "ArmMovementSpeed", style.detail.emM, 0, style.detail.yM, style.detail.widthM, false, new vec4(1, 1, 1, 0.5), 22);
    this.panel = this.node(this.base, "ManipulationMenu");
    this.panel.getTransform().setLocalPosition(new vec3(0, -13, 0));
    this.panel.getTransform().setLocalScale(new vec3(0.7, 0.7, 0.7));
    this.menuHeight.request(0.096, true);
    this.plate = createPanelSurface(this.panel, "ArmMenuPlate", 22.4, 9.6, new vec3(0, -4.8, 0), 1.6);
    this.previewMenu = this.node(this.object, "PreviewMenu");
    const add = (key: string, text: string, action: () => void, style = SnapOS2Styles.Secondary) => {
      const button = createIconButton(key === "plan" ? this.previewMenu : this.panel, key, text, key === "estop" ? 20 : 14, 3.2, vec3.zero(), style);
      this.subscriptions.push(button.button.onTriggerDown.add(() => { if ((this.controlsEnabled || key === "estop" || key === "stop") && !button.button.inactive) action(); }));
      button.labelText.size = 0.012 * 100 * 32 / 0.69492703;
      this.buttons.set(key, button);
    };
    add("plan", "Preview", () => core.action("plan"));
    add("execute", "Execute", () => core.action("execute"), SnapOS2Styles.Primary);
    add("reset", "Reset", () => core.action("reset"));
    add("stop", "Stop", () => core.action("stop"));
    add("estop", "E-stop", () => { if (this.state?.stopped) core.action("resume"); else { core.interaction.discard(); stop(); } }, SnapOS2Styles.Special);
    const speedRoot = this.node(this.panel, "ManipulationSpeed");
    this.speed = speedRoot.createComponent(Slider.getTypeName()) as Slider;
    this.speed.size = new vec3(14, 2.25, 0.5); this.speed.knobSize = new vec2(2.4, 2.4);
    this.speedLabel = createText({ parent: speedRoot, name: "SpeedLabel", text: "", fontSize: 0.011 * 100 * 32 / 0.69492703, color: COLOR_WHITE,
      position: new vec3(0, 2, 0), horizontalAlignment: HorizontalAlignment.Center, worldSpaceRect: Rect.create(-12, 12, -2, 2) });
    this.subscriptions.push(this.speed.onValueChange.add(value => {
      if (!this.syncingSpeed && core.interaction.snapshot().canManipulate) core.interaction.setSpeedScale(0.05 + Math.max(0, Math.min(1, value)) * 0.95);
    }));
    this.gripper = createIconButton(this.object, "Gripper", "Open", 9.5, 3.2, vec3.zero());
    this.subscriptions.push(this.gripper.button.interactable.onHoverEnter.add(() => { this.hoverUntil = getTime() + 0.3; }));
    this.warning = createText({ parent: this.object, name: "RejectedTarget", fontSize: 36, color: new vec4(1, 0.65, 0, 1),
      position: vec3.zero(), horizontalAlignment: HorizontalAlignment.Center, worldSpaceRect: Rect.create(-20, 20, -3, 3) });
  }

  private node(parent: SceneObject, name: string): SceneObject {
    const object = global.scene.createSceneObject(name); object.setParent(parent); return object;
  }
  pressEndEffectorAction(object: SceneObject, sourceId: string): boolean {
    let target: SceneObject | null = object;
    while (target && target !== this.gripper.sceneObject) target = target.getParent();
    if (!target) return false;
    const intent = this.core.interaction.snapshot();
    if (!this.controlsEnabled || this.gripper.button.inactive) return true;
    if (this.selected) { if (!intent.dragging && intent.canExecute) this.core.action("execute"); }
    else if (intent.canManipulate && this.capture.pressGripper(sourceId)) this.core.action("gripper");
    return true;
  }
  ownsMesh(object: SceneObject): boolean { return object === this.base || [...this.picks.values()].includes(object); }
  ownsHandle(object: SceneObject): boolean { return object === this.handle; }

  apply(state: ManipulationState | null | undefined, origin: ClientTrackingOrigin | null,
    selected: boolean, enabled: boolean, now: number, camera: SceneObject, title: string): void {
    this.state = state; this.controlsEnabled = enabled; this.selected = selected;
    this.object.enabled = !!origin && enabled;
    if (!this.object.enabled || !state?.available || !state.model || !origin) {
      this.object.enabled = !!origin && enabled && this.modelRevision !== "";
      this.meshFade.reset(); this.measured.object.enabled = false;
      this.handle.enabled = false; this.previewMenu.enabled = false; this.gripper.sceneObject.enabled = false;
      for (const mesh of this.meshes.values()) mesh.object.enabled = false;
      for (const pick of this.picks.values()) pick.enabled = false;
      for (const edge of this.edges.values()) edge.stroke.hide();
      this.path.hide();
      this.warning.text = state?.message ?? "Feedback unavailable";
      this.warning.getSceneObject().enabled = true;
      this.controlsEnabled = false;
      for (const [key, button] of this.buttons) button.button.inactive = key === "estop" ? !(this.core.interaction.snapshot().canStop || this.core.interaction.snapshot().canResume) : key !== "stop" || !this.core.interaction.snapshot().canStop;
      this.speed.enabled = false;
      return;
    }
    const model = state.model, interaction = this.core.interaction, intent = interaction.snapshot();
    const group = state.groups?.find(g => g.id === interaction.groupId), observed = state.observations?.[interaction.groupId ?? ""];
    const dt = this.lastTime ? Math.max(0, Math.min(0.1, now - this.lastTime)) : 1 / 60; this.lastTime = now;
    const context = `${model.revision}:${interaction.groupId}:${selected}:${intent.fresh}`;
    if (this.context !== context || origin !== this.lastOrigin) { this.jointFilter.reset(); this.previewFilter.reset(); this.progress.reset(); this.context = context; this.lastOrigin = origin; }
    const observedValues = Object.assign({}, ...Object.values(state.observations ?? {}).map(o => o.joints ?? {}), gripperJointValues(model, group, observed?.gripper));
    const all = this.jointFilter.sample(model, observedValues, context, now);
    const root: ManipulationPose = state.root_pose ?? { position: [0, 0, 0], orientation: [0, 0, 0, 1] };
    const plan = state.stopped ? null : (intent.executing ? state.plan : interaction.plan ?? interaction.previewPlan) ?? null;
    if (intent.dragging || state.stopped) this.core.presentation.reset();
    const playback = this.core.presentation.sample(plan, now);
    const configuration = playback.playing && plan ? samplePlan(plan, playback.time)
      : selected && plan && !interaction.rejection ? samplePlan(plan, plan.duration) : interaction.previewJoints;
    const proposed = { ...all, ...configuration, ...gripperJointValues(model, group, selected ? interaction.desiredGripper : observed?.gripper) };
    const values = playback.playing || interaction.rejection ? proposed : this.previewFilter.sample(model, proposed, context, now);
    const poses = linkPoses(model, values), measuredPoses = linkPoses(model, all);
    const displaced = !!interaction.target && intent.targetOffset;
    const markerAction = endEffectorAction(selected, intent, selected ? interaction.desiredGripper ?? observed?.gripper : observed?.gripper, group?.has_gripper === true);
    const displayedPose = interaction.target && (selected || intent.dragging || intent.finishing || intent.targetOffset) ? interaction.target : observed?.pose;
    if (this.modelRevision !== model.revision) {
      for (const unsubscribe of this.modelSubscriptions) unsubscribe(); this.modelSubscriptions.length = 0;
      for (const mesh of this.meshes.values()) mesh.destroy(); this.meshes.clear();
      for (const { stroke } of this.edges.values()) stroke.destroy(); this.edges.clear();
      for (const pick of this.picks.values()) pick.destroy(); this.picks.clear(); this.hoverSources.clear();
      this.modelRevision = model.revision; this.pathKey = "";
      for (const link of model.links) {
        const data = OPENYAM_MESH.links[link.name];
        if (!data || model.visual_signature !== OPENYAM_MESH.signature) continue;
        const mesh = new WorldMeshRenderer(this.object, `Arm_${link.name}`, ARM_MATERIAL);
        const rotate = (p: Vec3): Vec3 => link.name === model.root ? [-p[1], p[0], p[2]] : p;
        const positions: number[] = [], normals: number[] = [];
        for (let i = 0; i < data.positions.length; i += 3) {
          positions.push(...clientTrackingToSpecsPoint(rotate(data.positions.slice(i, i + 3) as Vec3)));
          normals.push(...clientTrackingToSpecsPoint(rotate(data.normals.slice(i, i + 3) as Vec3)).map(v => v / 100));
        }
        mesh.triangles(positions, data.indices, [0.8, 0.85, 0.88, 1], undefined, normals); this.meshes.set(link.name, mesh);
        const pickRoot = this.node(this.object, `Pick_${link.name}`);
        this.picks.set(link.name, pickRoot);
        const collider = pickRoot.createComponent("Physics.ColliderComponent") as ColliderComponent;
        const shape = Shape.createMeshShape() as MeshShape;
        shape.mesh = mesh.visual.mesh; shape.convex = false; collider.shape = shape;
        const hit = pickRoot.createComponent(Interactable.getTypeName()) as Interactable;
        hit.colliders = [collider];
        this.modelSubscriptions.push(hit.onHoverEnter.add(e => this.hoverSources.add(`${link.name}:${e.interactor.inputType}`)));
        this.modelSubscriptions.push(hit.onHoverExit.add(e => this.hoverSources.delete(`${link.name}:${e.interactor.inputType}`)));

        const stroke = new AdaptiveStrokeRenderer(this.object, `Outline_${link.name}`); stroke.minimumPixels = STYLE.minimumPixels;
        this.edges.set(link.name, { stroke, points: armShapeEdges(data.positions, data.indices).map(rotate) });
      }
    }
    const world = (pose: ManipulationPose): ManipulationPose => clientTrackingToSpecsPose(odomToClientTrackingPose(pose, origin));
    this.meshFade.beginFrame(now, `${model.revision}:${interaction.groupId}`);
    for (const link of model.links) {
      const pose = composePose(root, poses[link.name]), measuredPose = composePose(root, measuredPoses[link.name]);
      const style = armLinkPresentation({ selected, hovered: this.hoverSources.size > 0, dragging: intent.dragging,
        finishing: intent.finishing === true, displaced, playing: playback.playing,
        weight: armLinkWeight(measuredPoses[link.name], poses[link.name]), failed: interaction.rejection !== null,
        failedLink: model.joints.some(j => j.child === link.name && interaction.rejection?.failedJoints?.includes(j.name)) });
      const alpha = this.meshFade.sample(link.name, style.visible ? style.alpha : 0);
      const visible = alpha > 0.0001;
      const mesh = this.meshes.get(link.name);
      if (mesh) {
        mesh.setColor([((style.color >> 16) & 255) / 255, ((style.color >> 8) & 255) / 255, (style.color & 255) / 255, 1]);
        mesh.object.enabled = visible; this.place(mesh.object, pose, origin);
        configureArmMaterial(mesh.material, alpha);
      }
      const edge = this.edges.get(link.name);
      if (edge) {
        const color: Vec3 = [((style.color >> 16) & 255) / 255, ((style.color >> 8) & 255) / 255, (style.color & 255) / 255];
        edge.stroke.segments(visible ? edge.points.map(position => world(composePose(pose, { position, orientation: [0, 0, 0, 1] })).position) : [],
          style.widthM * 100, STYLE.opacity * alpha, STYLE.dashM * 100, STYLE.gapM * 100, false, color);
      }
      const pickRoot = this.picks.get(link.name);
      if (pickRoot) {
        pickRoot.enabled = intent.fresh;
        this.place(pickRoot, selected || displaced ? pose : measuredPose, origin);
      }
    }
    this.handle.enabled = !!observed?.pose;
    (this.handle.getComponent(Interactable.getTypeName()) as Interactable).enabled = intent.canManipulate;
    this.measured.object.enabled = !!observed?.pose;
    if (observed?.pose && displayedPose) {
      this.place(this.handle, displayedPose, origin); this.place(this.measured.object, observed.pose, origin);
      const p = this.handle.getTransform().getWorldPosition();
      if (this.handleHover.size || this.capture.owner !== null) this.hoverUntil = now + 0.3;
      this.hoverProgress += ((now < this.hoverUntil ? 1 : 0) - this.hoverProgress) * (1 - Math.exp(-14 * dt));
      this.gripper.sceneObject.enabled = markerAction.available && !state.stopped && (!intent.dragging || markerAction.allowDuringGrab) && this.hoverProgress > 0.01;
      this.gripper.sceneObject.getTransform().setLocalScale(new vec3(1, 1, 1).uniformScale(Math.max(0.01, this.hoverProgress)));
      this.gripper.sceneObject.getTransform().setWorldPosition(p.add(new vec3(0, -5.5 - this.hoverProgress * 2.5, 0)));
      this.gripper.sceneObject.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
      this.previewMenu.enabled = selected && displaced && !intent.dragging && !state.stopped;
      this.previewMenu.getTransform().setWorldPosition(p.add(new vec3(0, 8, 0)));
      this.previewMenu.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    }
    this.gripper.labelText.text = markerAction.label;
    this.gripper.button.inactive = !markerAction.enabled;
    setButtonStyle(this.gripper.button, selected ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary);
    this.place(this.base, root, origin); this.base.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    this.nameLabel.text = title;
    this.activityLabel.text = intent.activity + (model.visual_signature !== OPENYAM_MESH.signature ? " · Preview mesh unavailable" : "");
    this.label.text = `Movement speed ${Math.round(interaction.speedScale * 100)}%`;
    const handlePass = this.sphere.material.mainPass as Pass & { fill: number };
    handlePass.fill = selected ? 0.42 : 1;

    this.speedLabel.text = `Speed · ${Math.round(interaction.speedScale * 100)}%`;
    this.syncingSpeed = true; this.speed.currentValue = (interaction.speedScale - 0.05) / 0.95; this.syncingSpeed = false;
    this.speed.enabled = intent.canManipulate;
    const rows = manipulationMenuRows(selected, !!state.stopped);
    this.menuHeight.request(rows.length * 0.04 + 0.028); this.menuHeight.tick(dt);
    this.plate.size = new vec2(22.4, this.menuHeight.height * 100);
    this.plate.getSceneObject().getTransform().setLocalPosition(new vec3(0, -this.menuHeight.height * 50, 0));
    rows.forEach((key, i) => (key === "speed" ? this.speed.getSceneObject() : this.buttons.get(key)!.sceneObject).getTransform().setLocalPosition(new vec3(0, -2.8 - i * 4 - (key === "speed" ? 1 : i > rows.indexOf("speed") ? 1.2 : 0), 0.8)));
    for (const [key, button] of this.buttons) {
      if (key !== "plan") button.sceneObject.enabled = rows.includes(key);
      button.button.inactive = !manipulationButtonEnabled(key, intent);
    }
    const emergency = this.buttons.get("estop")!;
    emergency.labelText.text = state.stopped ? "Resume operation" : "E-stop";
    setButtonStyle(emergency.button, state.stopped ? SnapOS2Styles.Primary : SnapOS2Styles.Special);
    this.warning.getSceneObject().enabled = interaction.rejection !== null || !intent.fresh;
    this.warning.text = interaction.rejection?.message ?? "Feedback unavailable";
    if (displayedPose) this.place(this.warning.getSceneObject(), displayedPose, origin);
    this.warning.getSceneObject().getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    const time = plan && intent.executing && observed?.joints ? this.progress.advance(plan, observed.joints,
      new Set(model.joints.filter(j => j.kind === "continuous").map(j => j.name)), state.operation_id ?? plan.plan_id) : 0;
    if (!intent.executing) this.progress.reset();
    const points: Vec3[] = [];
    if (plan && group?.tip_frame) {
      const key = JSON.stringify([plan.plan_id, time, origin, root]);
      if (key !== this.pathKey) {
        this.pathKey = key;
        this.pathPoints = manipulationPlanPath(model, plan, group.tip_frame, all, root, time).map(position => world({ position, orientation: [0, 0, 0, 1] }).position);
      }
      if (displaced || playback.playing || intent.executing) points.push(...this.pathPoints);
    } else if (displaced && interaction.target && observed?.pose) points.push(world(observed.pose).position, world(interaction.target).position);
    this.path.segments(points.slice(0, -1).flatMap((p, i) => [p, points[i + 1]]), WORLD_DASH_STYLE.widthM * 65, manipulationPathOpacity(intent, !selected && state.following === true && !interaction.rejection, !!plan), 1.2, 1, true);
  }
  private place(object: SceneObject, pose: ManipulationPose, origin: ClientTrackingOrigin): void {
    const p = clientTrackingToSpecsPose(odomToClientTrackingPose(pose, origin));
    object.getTransform().setWorldPosition(new vec3(...p.position));
    object.getTransform().setWorldRotation(new quat(p.orientation[3], p.orientation[0], p.orientation[1], p.orientation[2]));
  }
  dispose(): void {
    for (const unsubscribe of this.modelSubscriptions) unsubscribe();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    for (const pick of this.picks.values()) pick.destroy();
    this.object.destroy();
  }
}
