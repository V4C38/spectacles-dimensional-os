import { SpecsArmPanelPresenter } from "./SpecsArmPanelPresenter";
import { ArmStrokeRenderer } from "./ArmStrokeRenderer";
import { EndEffectorStatusPill } from "./EndEffectorStatusPill";
import { endEffectorAngles, endEffectorDisplayPose } from "../../DimOSARClient/manipulation/ManipulationVisuals";
import { ARM_PANEL_STYLE, PANEL_PIN_SEGMENTS, PANEL_SCAN_SEGMENTS } from "../../DimOSARClient/presentation/PanelFrameStyle";
import { manipulationObservedJoints, manipulationProposedJoints, manipulationActivePlan, manipulationMenuRows, manipulationButtonEnabled, endEffectorAction, manipulationPathOpacity } from "../../DimOSARClient/manipulation/ManipulationPresentation";
import { PanelHeightAnimation } from "../../DimOSARClient/presentation/PanelHeightAnimation";
import { armMotionContext, ArmJointFilter } from "../../DimOSARClient/manipulation/ArmJointFilter";
import { ArmTrajectoryProgress } from "../../DimOSARClient/manipulation/ArmTrajectoryProgress";
import { ARM_VISUAL_STYLE as STYLE, armShapeEdges, armPointDisplacement, armLinkWeight, armLinkPresentation, ArmMeshFade, ArmPointOpacity, armPointOpacityKey, ArmOpacityCadence } from "../../DimOSARClient/manipulation/ManipulationVisuals";
import { ARM_MATERIAL, configureArmMaterial, ARM_SURFACE_MATERIAL, configureArmSurface } from "./ArmMaterial";
import type { ManipulationInputCapture } from "../../DimOSARClient/manipulation/ManipulationInputCapture";
import { WORLD_DASH_STYLE, ROBOT_LABEL_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, sphereMesh } from "../presentation/WorldMeshRenderer";
import { createIconButton, createText, createRobotLabelText,  panelButtonLayer, setButtonStyle, uiMaterialLayer, SnapOS2Styles, COLOR_WHITE, type IconButtonResult } from "../presentation/UIKit";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { odomToClientTrackingPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { composePose, linkPoses, manipulationPlanPath } from "../../DimOSARClient/manipulation/ModelKinematics";
import type { ManipulationController } from "../../DimOSARClient/manipulation/ManipulationController";
import type { ManipulationPose, ManipulationState } from "../../DimOSARClient/manipulation/ManipulationTypes";
import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { OPENYAM_MESH } from "./OpenYAMMesh";

export class ManipulationRenderer {
  private readonly placements = new Map<SceneObject, ManipulationPose>();
  private readonly geometry = new Map<string, { positions: number[]; normals: number[]; indices: readonly number[]; points: Vec3[]; opacity: ArmPointOpacity; fillAlpha?: number; color?: number }>();
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
  private readonly panelTitle: Text;
  localizationAvailable = false;
  private readonly rescan: IconButtonResult;
  private scanIcon: WorldMeshRenderer | null = null;
  private readonly warning: EndEffectorStatusPill;
  private readonly buttons = new Map<string, IconButtonResult>();
  private readonly picks = new Map<string, SceneObject>();
  private readonly meshes = new Map<string, WorldMeshRenderer>();
  private readonly edges = new Map<string, { stroke: ArmStrokeRenderer; points: Vec3[]; localPoints: Vec3[]; opacity: ArmPointOpacity; renderKey: string }>();
  private readonly path: AdaptiveStrokeRenderer;
  private readonly measured: WorldMeshRenderer;
  private readonly subscriptions: (() => void)[] = [];
  private readonly modelSubscriptions: (() => void)[] = [];
  private readonly hoverSources = new Set<string>();
  private readonly handleHover = new Set<string>();
  private readonly actionHover = new Set<string>();
  private readonly jointFilter = new ArmJointFilter();
  private previousSolution: object | null = null;
  private solutionSequence = 0;
  private readonly previewFilter = new ArmJointFilter(0.15, 0.25);
  private readonly progress = new ArmTrajectoryProgress();
  private readonly speed: Slider;
  private readonly panelPresenter: SpecsArmPanelPresenter;
  private readonly menuHeight = new PanelHeightAnimation();
  private syncingSpeed = false;
  private menuRows = "";
  private modelRevision = "";
  private context = "";
  private pathKey = "";
  private pathPoints: Vec3[] = [];
  private pathDistances: number[] = [];
  private uploadedPath = "";
  private lastTime = 0;
  private hoverUntil = 0;
  private hoverProgress = 0;
  private state: ManipulationState | null | undefined;
  private controlsEnabled = false;
  private readonly meshFade = new ArmMeshFade();
  private readonly opacityCadence = new ArmOpacityCadence();
  private readonly pointFade = new ArmMeshFade();
  private readonly fillFade = new ArmMeshFade();
  private selected = false;
  debugEnabled = false;
  private readonly debugNodes = new Map<string, {axes: AdaptiveStrokeRenderer[]; label: Text}>();

  constructor(parent: SceneObject, private readonly core: ManipulationController,
    stop: () => void, private readonly capture: ManipulationInputCapture, private readonly recalibrate: () => void = () => {}) {
    this.object = this.node(parent, "Manipulation");
    this.handle = this.node(this.object, "EndEffectorHandle");
    const geometry = sphereMesh(0.9, 20, 16);
    this.sphere = new WorldMeshRenderer(this.handle, "EndEffectorSphere", ARM_MATERIAL);
    configureArmMaterial(this.sphere.material);
    (this.sphere.material.mainPass as Pass & { fill: number }).fill = 0.75;
    const handleGeometry = sphereMesh(1.2, 20, 16);
    this.sphere.triangles(handleGeometry.positions, handleGeometry.indices, [0.82, 0.82, 0.82, 1], undefined, handleGeometry.normals);
    const collider = this.handle.createComponent("Physics.ColliderComponent") as ColliderComponent;
    collider.shape = Shape.createSphereShape(); (collider.shape as SphereShape).radius = 3.6;
    const hit = this.handle.createComponent(Interactable.getTypeName()) as Interactable;
    hit.keepHoverOnTrigger = true; hit.useFilteredPinch = true; hit.enableInstantDrag = true;
    this.subscriptions.push(hit.onHoverEnter.add(e => this.handleHover.add(String(e.interactor.inputType))));
    this.subscriptions.push(hit.onHoverExit.add(e => this.handleHover.delete(String(e.interactor.inputType))));
    this.measured = new WorldMeshRenderer(this.object, "MeasuredEndEffector", ARM_MATERIAL);
    uiMaterialLayer(this.measured.visual, 51);
    const pass = this.measured.material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number };
    pass.fill = 0.30; pass.edgeOpacity = 0.30; pass.power = 6;
    const measuredGeometry = sphereMesh(0.6, 20, 16);
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
    this.panelPresenter = new SpecsArmPanelPresenter(this.object);
    this.panel = this.panelPresenter.content;
    this.menuHeight.request(4 * ARM_PANEL_STYLE.rowM + ARM_PANEL_STYLE.paddingM + ARM_PANEL_STYLE.headerM, true);
    this.previewMenu = this.node(this.object, "PreviewMenu");
    const add = (key: string, text: string, action: () => void, style = SnapOS2Styles.Secondary) => {
      const button = createIconButton(key === "plan" || key === "execute" ? this.previewMenu : this.panel, key, text, key === "estop" ? 20 : key === "plan" || key === "execute" ? 9.5 : key === "reset" || key === "stop" ? 9.2 : 14, ARM_PANEL_STYLE.buttonHeightM*100, vec3.zero(), style);
      this.subscriptions.push(button.button.onTriggerDown.add(() => { if ((this.controlsEnabled || key === "estop" || key === "stop") && !button.button.inactive) action(); }));
      button.labelText.size = ARM_PANEL_STYLE.buttonFontM * 100 * 32 / 0.69492703;
      if (key === "plan" || key === "execute") {
        button.sceneObject.getTransform().setLocalPosition(new vec3(0, key === "plan" ? 3.9 : 0, 0));
        this.subscriptions.push(button.button.interactable.onHoverEnter.add(() => this.actionHover.add(key)));
        this.subscriptions.push(button.button.interactable.onHoverExit.add(() => this.actionHover.delete(key)));
      }
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
    this.subscriptions.push(this.gripper.button.interactable.onHoverEnter.add(() => this.actionHover.add("gripper")));
    this.subscriptions.push(this.gripper.button.interactable.onHoverExit.add(() => this.actionHover.delete("gripper")));
    const pin = createIconButton(this.panel,"Pin to robot","",ARM_PANEL_STYLE.pinSizeM*100,ARM_PANEL_STYLE.pinSizeM*100,
      new vec3(ARM_PANEL_STYLE.pinXM*100,ARM_PANEL_STYLE.pinYM*100,.8),SnapOS2Styles.Secondary);
    panelButtonLayer(pin);
    this.subscriptions.push(pin.button.onTriggerUp.add(() => this.resetPanel()));
    this.panelTitle = createText({parent: this.panel, name: "ArmPanelTitle", text: "Arm", fontSize: 1.3 * 32 / .69492703, color: COLOR_WHITE,
      position: new vec3(-9.6, ARM_PANEL_STYLE.pinYM*100, 1.4), horizontalAlignment: HorizontalAlignment.Left, worldSpaceRect: Rect.create(0,12,-1.6,1.6)});
    const rescan = this.rescan = createIconButton(this.panel, "Recalibrate", "", ARM_PANEL_STYLE.pinSizeM*100, ARM_PANEL_STYLE.pinSizeM*100, new vec3((ARM_PANEL_STYLE.pinXM-.039)*100, ARM_PANEL_STYLE.pinYM*100,.8));
    panelButtonLayer(rescan);
    this.subscriptions.push(rescan.button.onTriggerUp.add(() => { const intent = this.core.interaction.snapshot(); if (!intent.executing && !intent.dragging && !intent.resetting) this.recalibrate(); }));
    const drawIcon = (segments: readonly (readonly [number,number])[], x: number) => {
    const icon = new WorldMeshRenderer(this.panel,"PinIcon");
    icon.object.getTransform().setLocalPosition(new vec3(x*100,ARM_PANEL_STYLE.pinYM*100,1.4));
    uiMaterialLayer(icon.visual, 66);
    const positions:number[]=[], indices:number[]=[];
    for(let i=0;i<segments.length;i+=2){
      const a=segments[i],b=segments[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length*ARM_PANEL_STYLE.iconStrokeM*50,ny=dx/length*ARM_PANEL_STYLE.iconStrokeM*50,k=positions.length/3;
      positions.push(a[0]*100+nx,a[1]*100+ny,.2,a[0]*100-nx,a[1]*100-ny,.2,b[0]*100+nx,b[1]*100+ny,.2,b[0]*100-nx,b[1]*100-ny,.2);
      indices.push(k,k+1,k+2,k+2,k+1,k+3);
    }
    const xs = positions.filter((_, i) => i % 3 === 0), ys = positions.filter((_, i) => i % 3 === 1);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (let i = 0; i < positions.length; i += 3) { positions[i] -= cx; positions[i+1] -= cy; }
    icon.triangles(positions,indices,[1,1,1,1]);
    return icon;
    };
    drawIcon(PANEL_PIN_SEGMENTS, ARM_PANEL_STYLE.pinXM);
    this.scanIcon = drawIcon(PANEL_SCAN_SEGMENTS, ARM_PANEL_STYLE.pinXM-.039);
    this.warning = new EndEffectorStatusPill(this.object);
  }

  resetPanel(): void { this.panelPresenter.reset(); }

  private node(parent: SceneObject, name: string): SceneObject {
    const object = global.scene.createSceneObject(name); object.setParent(parent); return object;
  }
  pressEndEffectorAction(object: SceneObject, sourceId: string): boolean {
    let target: SceneObject | null = object;
    while (target && target !== this.gripper.sceneObject) target = target.getParent();
    if (!target) return false;
    const intent = this.core.interaction.snapshot();
    if (!this.controlsEnabled || this.gripper.button.inactive) return true;
    if (intent.canManipulate && this.capture.pressGripper(sourceId)) this.core.action("gripper");
    return true;
  }
  ownsMesh(object: SceneObject): boolean { return object === this.base || [...this.picks.values()].includes(object); }
  ownsHandle(object: SceneObject): boolean { return object === this.handle; }

  apply(state: ManipulationState | null | undefined, origin: ClientTrackingOrigin | null,
    selected: boolean, enabled: boolean, now: number, camera: SceneObject, title: string): void {
    if(this.core.interaction.retainingFeedback && origin) {
      this.core.presentation.hold(now);
      this.jointFilter.hold(now); this.previewFilter.hold(now);
      this.controlsEnabled = false;
      for (const [key, button] of this.buttons) button.button.inactive = key !== "estop" && key !== "stop";
      this.gripper.button.inactive = true; this.speed.enabled = false;
      if(this.core.interaction.target) this.place(this.handle,this.core.interaction.target,origin);
      this.warning.apply({ blocked: false, fresh: false, stopped: false, moving: false,
        rejection: null }, this.handle, camera, now);
      this.activityLabel.text="No feedback"; return;
    }
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
      this.warning.apply({ blocked: false, fresh: false, stopped: false, moving: false,
        rejection: null }, this.handle, camera, now);
      this.controlsEnabled = false;
      for (const [key, button] of this.buttons) button.button.inactive = key === "estop" ? !(this.core.interaction.snapshot().canStop || this.core.interaction.snapshot().canResume) : key !== "stop" || !this.core.interaction.snapshot().canStop;
      this.speed.enabled = false;
      return;
    }
    const model = state.model, interaction = this.core.interaction, intent = interaction.snapshot();
    const group = state.groups?.find(g => g.id === interaction.groupId), observed = state.observations?.[interaction.groupId ?? ""];
    const dt = this.lastTime ? Math.max(0, Math.min(0.1, now - this.lastTime)) : 1 / 60; this.lastTime = now;
    const context = armMotionContext(model.revision, interaction.groupId, origin);
    if (this.context !== context) { this.jointFilter.reset(); this.previewFilter.reset(); this.progress.reset(); this.context = context; }
    const observedValues = manipulationObservedJoints(model, state, group);
    const all = this.jointFilter.sample(model, observedValues, context, now, .1, observed?.measured_at ?? undefined, observed?.joint_velocities);
    const root: ManipulationPose = state.root_pose ?? { position: [0, 0, 0], orientation: [0, 0, 0, 1] };
    const plan = manipulationActivePlan(state, interaction.plan, intent.executing);
    if (intent.dragging || state.stopped) this.core.presentation.reset();
    const playback = this.core.presentation.sample(plan, now);
    const proposed = manipulationProposedJoints(model, group, observedValues, {
      plan, playback, selected, dragging: intent.dragging, rejected: !!interaction.rejection,
      solution: interaction.previewJoints, opening: selected ? interaction.desiredGripper : observed?.gripper,
    });
    if(interaction.previewJoints !== this.previousSolution) { this.previousSolution = interaction.previewJoints; this.solutionSequence++; }
    const source = selected ? `${plan?.plan_id ?? this.solutionSequence}` : `${this.solutionSequence}`;
    const values = playback.playing ? this.previewFilter.playback(model,proposed,context,now,playback.time) : this.previewFilter.sample(model, proposed, context, now, .1, source);
    const poses = linkPoses(model, values), measuredPoses = linkPoses(model, all);
    const displaced = !!interaction.target && intent.targetOffset;
    const markerAction = endEffectorAction(selected, intent, selected ? interaction.desiredGripper ?? observed?.gripper_target ?? observed?.gripper : observed?.gripper, group?.has_gripper === true);
    const displayedPose = endEffectorDisplayPose(observed?.pose, interaction.target, {
      selected, following: state.following === true, dragging: intent.dragging === true,
      finishing: intent.finishing === true, offset: intent.targetOffset,
    });
    if (this.modelRevision !== model.revision) {
      for (const unsubscribe of this.modelSubscriptions) unsubscribe(); this.modelSubscriptions.length = 0;
      for (const mesh of this.meshes.values()) mesh.destroy(); this.meshes.clear();
      for (const { stroke } of this.edges.values()) stroke.destroy(); this.edges.clear();
      for (const pick of this.picks.values()) pick.destroy(); this.picks.clear(); this.hoverSources.clear();
      this.geometry.clear(); this.placements.clear();
      this.modelRevision = model.revision; this.pathKey = "";
      for (const link of model.links) {
        const data = OPENYAM_MESH.links[link.name];
        if (!data || model.visual_signature !== OPENYAM_MESH.signature) continue;
        const mesh = new WorldMeshRenderer(this.object, `Arm_${link.name}`, ARM_SURFACE_MATERIAL);
        const rotate = (p: Vec3): Vec3 => link.name === model.root ? [-p[1], p[0], p[2]] : p;
        const positions: number[] = [], normals: number[] = [];
        for (let i = 0; i < data.positions.length; i += 3) {
          positions.push(...clientTrackingToSpecsPoint(rotate(data.positions.slice(i, i + 3) as Vec3)));
          normals.push(...clientTrackingToSpecsPoint(rotate(data.normals.slice(i, i + 3) as Vec3)).map(v => v / 100));
        }
        this.geometry.set(link.name, { positions, normals, indices: data.indices, opacity: new ArmPointOpacity(), points: Array.from({length: data.positions.length / 3}, (_, i) => rotate(data.positions.slice(i * 3, i * 3 + 3) as Vec3)) });
        mesh.triangles(positions, data.indices, [0.8, 0.85, 0.88, 1], undefined, normals); this.meshes.set(link.name, mesh);
        const pickRoot = this.node(this.object, `Pick_${link.name}`);
        this.picks.set(link.name, pickRoot);
        const collider = pickRoot.createComponent("Physics.ColliderComponent") as ColliderComponent;
        const shape = Shape.createMeshShape() as MeshShape;
        const pickingMesh = new WorldMeshRenderer(pickRoot, `PickGeometry_${link.name}`, ARM_MATERIAL);
        pickingMesh.triangles(positions, data.indices, [1, 1, 1, 1], undefined, normals);
        pickingMesh.visual.enabled = false;
        // Opacity uploads must not invalidate the physics mesh every frame.
        shape.mesh = pickingMesh.visual.mesh; shape.convex = false; collider.shape = shape;
        const hit = pickRoot.createComponent(Interactable.getTypeName()) as Interactable;
        hit.colliders = [collider];
        this.modelSubscriptions.push(hit.onHoverEnter.add(e => this.hoverSources.add(`${link.name}:${e.interactor.inputType}`)));
        this.modelSubscriptions.push(hit.onHoverExit.add(e => this.hoverSources.delete(`${link.name}:${e.interactor.inputType}`)));

        const stroke = new ArmStrokeRenderer(this.object, `Outline_${link.name}`); stroke.minimumPixels = STYLE.minimumPixels;
        const points = armShapeEdges(data.positions, data.indices).map(rotate);
        this.edges.set(link.name, { stroke, points, localPoints: points.map(clientTrackingToSpecsPoint), opacity: new ArmPointOpacity(), renderKey: "" });
      }
    }
    const world = (pose: ManipulationPose): ManipulationPose => clientTrackingToSpecsPose(odomToClientTrackingPose(pose, origin));
    this.meshFade.beginFrame(now, `${model.revision}:${interaction.groupId}`);
    const opacityElapsed = this.opacityCadence.sample(now);
    const sampleOpacity = opacityElapsed !== null;
    if (sampleOpacity) this.pointFade.beginFrame(now, `${model.revision}:${interaction.groupId}`);
    this.fillFade.beginFrame(now, `${model.revision}:${interaction.groupId}`);
    for (const link of model.links) {
      const pose = composePose(root, poses[link.name]);
      const style = armLinkPresentation({ selected, hovered: this.hoverSources.size > 0, dragging: intent.dragging,
        finishing: intent.finishing === true, displaced, playing: playback.playing,
        weight: displaced ? 1 : armLinkWeight(measuredPoses[link.name], poses[link.name]), failed: interaction.rejection !== null,
        failedLink: model.joints.some(j => j.child === link.name && interaction.rejection?.failedJoints?.includes(j.name)) });
      const alpha = this.meshFade.sample(link.name, style.visible ? style.alpha : 0);
      const fillAlpha = this.fillFade.sample(link.name, style.showFill ? style.alpha : 0);
      const pointWeight = armPointDisplacement(measuredPoses[link.name], poses[link.name]);
      const opacityKey = armPointOpacityKey(measuredPoses[link.name], poses[link.name], style.pointVisible, style.floor, style.displacementBoost);
      const pointOpacity = (point: Vec3) => style.pointVisible ? style.floor + Math.max(0, pointWeight(...point) - style.floor) * style.displacementBoost : 0;
      const visible = alpha > 0.0001;
      const mesh = this.meshes.get(link.name);
      if (mesh) {
        configureArmSurface(mesh.material, fillAlpha, style.color);
        const data = this.geometry.get(link.name);
        if (data) {
          const weightsChanged = sampleOpacity && data.opacity.sample(data.points, opacityKey, pointOpacity,
            (previous, target) => this.pointFade.sampleValue(previous, target));
          const changed = data.color === undefined || weightsChanged;
          if (changed) {
            mesh.triangles(data.positions, data.indices, [((style.color >> 16) & 255) / 255, ((style.color >> 8) & 255) / 255, (style.color & 255) / 255, 1], undefined, data.normals, data.opacity.values);
            data.color = style.color;
          }
        }
        mesh.object.enabled = visible; this.place(mesh.object, pose, origin);
        const geometry = this.geometry.get(link.name);
        if (geometry && geometry.fillAlpha !== fillAlpha) {
          configureArmSurface(mesh.material, fillAlpha, style.color); geometry.fillAlpha = fillAlpha;
        }
      }
      const edge = this.edges.get(link.name);
      if (edge) {
        const color: Vec3 = [((style.color >> 16) & 255) / 255, ((style.color >> 8) & 255) / 255, (style.color & 255) / 255];
        const weightsChanged = sampleOpacity && edge.opacity.sample(edge.points, opacityKey, pointOpacity,
          (previous, target) => this.pointFade.sampleValue(previous, target));
        if (!visible) { edge.stroke.hide(); }
        else {
          edge.stroke.object.enabled = true;
          const renderKey = JSON.stringify([style.widthM]);
          edge.stroke.pose(world(pose));
          edge.stroke.style(style.widthM * 100, STYLE.opacity * alpha, color);
          if (weightsChanged || edge.renderKey !== renderKey) {
            edge.stroke.segments(edge.localPoints,
              style.widthM * 100, 1, STYLE.dashM * 100, STYLE.gapM * 100, false, [1, 1, 1], edge.opacity.values);
            edge.stroke.style(style.widthM * 100, STYLE.opacity * alpha, color);
            edge.renderKey = renderKey;
          }
        }
      }
      const pickRoot = this.picks.get(link.name);
      if (pickRoot) {
        pickRoot.enabled = intent.fresh;
        this.place(pickRoot, pose, origin);
      }
    }
    for (const entry of this.debugNodes.values()) { for (const axis of entry.axes) axis.hide(); entry.label.getSceneObject().enabled = false; }
    if (this.debugEnabled) {
      const debug = (name: string, pose: ManipulationPose | null | undefined, angle?: number | string) => {
        if (!pose) return;
        let entry = this.debugNodes.get(name);
        if (!entry) {
          entry = {axes: [0,1,2].map(i => new AdaptiveStrokeRenderer(this.object, `Debug_${name}_${i}`)),
            label: createRobotLabelText(this.object, `Angle_${name}`, ROBOT_LABEL_STYLE.detail.emM, 0, 0, 0.3, false, new vec4(1,1,1,0.5), 22)};
          this.debugNodes.set(name, entry);
        }
        const p = world(pose).position;
        for (let i = 0; i < 3; i++) {
          const v: Vec3 = [0,0,0]; v[i] = 0.04;
          const end = world(composePose(pose, {position: v, orientation: [0,0,0,1]})).position;
          const color: Vec3 = [0,0,0]; color[i] = 1;
          entry.axes[i].segments([p, end], 0.1, 1, 100, 0, false, color);
        }
        entry.label.getSceneObject().enabled = angle != null;
        entry.label.text = angle == null ? "" : typeof angle === "string" ? angle : `${name} ${(angle * 180 / Math.PI).toFixed(1)}°`;
        entry.label.getSceneObject().getTransform().setWorldPosition(new vec3(p[0],p[1]+4.5,p[2]));
        entry.label.getSceneObject().getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
      };
      debug("base", root); debug("current-ee", observed?.pose, observed?.pose ? endEffectorAngles(root, observed.pose) : undefined); debug("target-ee", displayedPose, displayedPose ? endEffectorAngles(root, displayedPose) : undefined);
      const rawPoses = linkPoses(model, observedValues);
      for (const joint of model.joints) if (["revolute","continuous"].includes(joint.kind) && observedValues[joint.name] != null)
        debug(joint.name, composePose(root, rawPoses[joint.child]), observedValues[joint.name]);
    }
    this.handle.enabled = !!observed?.pose;
    (this.handle.getComponent(Interactable.getTypeName()) as Interactable).enabled = intent.canManipulate;
    this.measured.object.enabled = !!observed?.pose;
    if (observed?.pose && displayedPose) {
      this.place(this.handle, displayedPose, origin); this.place(this.measured.object, observed.pose, origin);
      const p = this.handle.getTransform().getWorldPosition();
      if (this.handleHover.size || this.actionHover.size || this.capture.owner !== null) this.hoverUntil = now + 0.3;
      this.hoverProgress += ((now < this.hoverUntil ? 1 : 0) - this.hoverProgress) * (1 - Math.exp(-14 * dt));
      this.gripper.sceneObject.enabled = markerAction.available && !state.stopped && (!intent.dragging || markerAction.allowDuringGrab) && this.hoverProgress > 0.01;
      this.gripper.sceneObject.getTransform().setLocalScale(new vec3(1, 1, 1).uniformScale(Math.max(0.01, this.hoverProgress)));
      this.gripper.sceneObject.getTransform().setWorldPosition(p.add(new vec3(0, -5, 0)));
      this.gripper.sceneObject.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
      this.previewMenu.enabled = selected && !intent.dragging && !state.stopped && this.hoverProgress > 0.01;
      this.previewMenu.getTransform().setLocalScale(new vec3(1,1,1).uniformScale(Math.max(0.01, this.hoverProgress)));
      this.previewMenu.getTransform().setWorldPosition(p.add(new vec3(0, 5, 0)));
      this.previewMenu.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    }
    this.gripper.labelText.text = markerAction.label;
    this.gripper.button.inactive = !markerAction.enabled;
    setButtonStyle(this.gripper.button, SnapOS2Styles.Secondary);
    this.place(this.base, root, origin); this.base.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    this.nameLabel.text = title;
    this.panelTitle.text = title.length > 15 ? `${title.slice(0,14)}…` : title;
    this.rescan.sceneObject.enabled = this.localizationAvailable;
    if(this.scanIcon) this.scanIcon.object.enabled = this.localizationAvailable;
    this.rescan.button.inactive = intent.executing || intent.dragging || intent.resetting;
    this.activityLabel.text = intent.activity + (model.visual_signature !== OPENYAM_MESH.signature ? " · Preview mesh unavailable" : "");
    this.label.text = `Movement speed ${Math.round(interaction.speedScale * 100)}%`;
    this.sphere.setColor(interaction.rejection ? [1, 0.8, 0, 1] : [0.82, 0.82, 0.82, 1]);

    this.speedLabel.text = `Speed · ${Math.round(interaction.speedScale * 100)}%`;
    const speedValue = (interaction.speedScale - 0.05) / 0.95;
    if (this.speed.currentValue !== speedValue) {
      this.syncingSpeed = true; this.speed.currentValue = speedValue; this.syncingSpeed = false;
    }
    this.speed.enabled = intent.canManipulate;
    const rows = manipulationMenuRows(selected, !!state.stopped);
    this.menuHeight.request((rows.length-1) * ARM_PANEL_STYLE.rowM + ARM_PANEL_STYLE.paddingM + ARM_PANEL_STYLE.headerM); this.menuHeight.tick(dt);
    this.panelPresenter.update(state.root_pose ? this.base : null, camera, this.menuHeight.height);
    const menuRows = rows.join(":");
    if (menuRows !== this.menuRows) rows.forEach(key => {
      const i = key === "stop" || key === "reset" ? 0 : key === "speed" ? 1 : 2;
      const node = key === "speed" ? this.speed.getSceneObject() : this.buttons.get(key)!.sceneObject;
      node.getTransform().setLocalPosition(new vec3(key === "reset" ? 5.3 : key === "stop" ? -5.3 : 0, -ARM_PANEL_STYLE.headerM*100-2.8-i*4-(key === "speed" ? 1 : i>1 ? 1.2 : 0),.8));
    });
    this.menuRows = menuRows;
    for (const [key, button] of this.buttons) {
      if (key !== "plan" && key !== "execute") button.sceneObject.enabled = rows.includes(key);
      button.button.inactive = !manipulationButtonEnabled(key, intent);
    }
    const emergency = this.buttons.get("estop")!;
    emergency.labelText.text = state.stopped ? "Resume operation" : "E-stop";
    setButtonStyle(emergency.button, state.stopped ? SnapOS2Styles.Primary : SnapOS2Styles.Special);
    this.warning.apply({ blocked: intent.blocked === true, fresh: intent.fresh, stopped: intent.stopped,
      moving: intent.executing || intent.resetting, rejection: interaction.rejection }, this.handle, camera, now);
    const time = plan && intent.executing && observed?.joints ? this.progress.advance(plan, observed.joints,
      new Set(model.joints.filter(j => j.kind === "continuous").map(j => j.name)), state.operation_id ?? plan.plan_id) : 0;
    if (!intent.executing) this.progress.reset();
    const points: Vec3[] = [];
    if (plan && group?.tip_frame) {
      const key = JSON.stringify([plan.plan_id, model.revision, origin, root]);
      if (key !== this.pathKey) {
        this.pathKey = key;
        this.pathPoints = manipulationPlanPath(model, plan, group.tip_frame, observedValues, root).map(position => world({ position, orientation: [0, 0, 0, 1] }).position);
        this.pathDistances = [0];
        for (let i = 1; i < this.pathPoints.length; i++) this.pathDistances.push(this.pathDistances[i - 1] + Math.hypot(...this.pathPoints[i].map((v, axis) => v - this.pathPoints[i - 1][axis])));
      }
      if (displaced || playback.playing || intent.executing) points.push(...this.pathPoints);
    } else if (displaced && interaction.target && observed?.pose) points.push(world(observed.pose).position, world(interaction.target).position);
    const geometryKey = plan ? this.pathKey : JSON.stringify(points);
    if (geometryKey !== this.uploadedPath) {
      this.uploadedPath = geometryKey;
      this.path.segments(points.slice(0, -1).flatMap((p, i) => [p, points[i + 1]]), WORLD_DASH_STYLE.widthM * 65, 1, 1.2, 1, true);
    }
    this.path.object.enabled = points.length >= 2;
    const cursor = plan ? Math.min(this.pathDistances.length - 1, time / Math.max(1e-6, plan.duration) * (this.pathDistances.length - 1)) : 0;
    const lower = Math.max(0, Math.floor(cursor)), upper = Math.min(this.pathDistances.length - 1, lower + 1);
    const startDistance = plan && this.pathDistances.length ? this.pathDistances[lower] + (this.pathDistances[upper] - this.pathDistances[lower]) * (cursor - lower) : 0;
    this.path.style(WORLD_DASH_STYLE.widthM * 65, manipulationPathOpacity(intent, !selected && state.following === true && !interaction.rejection, !!plan), [1,1,1], startDistance);
  }
  private place(object: SceneObject, pose: ManipulationPose, origin: ClientTrackingOrigin): void {
    const p = clientTrackingToSpecsPose(odomToClientTrackingPose(pose, origin));
    const previous = this.placements.get(object);
    if (previous && p.position.every((v, i) => v === previous.position[i]) &&
      p.orientation.every((v, i) => v === previous.orientation[i])) return;
    object.getTransform().setWorldPosition(new vec3(...p.position));
    object.getTransform().setWorldRotation(new quat(p.orientation[3], p.orientation[0], p.orientation[1], p.orientation[2]));
    this.placements.set(object, p);
  }
  dispose(): void {
    this.placements.clear(); this.panelPresenter.dispose();
    for (const unsubscribe of this.modelSubscriptions) unsubscribe();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    for (const pick of this.picks.values()) pick.destroy();
    this.object.destroy();
  }
}
