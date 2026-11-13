import type { ReadonlyFacts } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import type { ManipulationPose as MutableManipulationPose, ManipulationState as MutableManipulationState } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationTypes";
import { ARM_VISUAL_STYLE, armTransformDifference, EndEffectorStatus, END_EFFECTOR_STATUS_STYLE, type EndEffectorStatusInput, endEffectorAction, manipulationButtonEnabled, manipulationMenuRows, ArmMeshFade, ArmOpacityCadence, ARM_VISUAL_STYLE as STYLE, armLinkPresentation, armLinkWeight, armShapeEdges, endEffectorAngles } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationPresentation";
import { clientTrackingToSpecsPose, clientTrackingToSpecsPoint } from "../utilities/SpecsCoordinates";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, sphereMesh } from "../presentation/WorldMeshRenderer";

import { ViewerNotificationPresenter } from "../presentation/ViewerNotificationPresenter";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { type ClientTrackingOrigin as MutableClientTrackingOrigin, odomToClientTrackingPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

import { ManipulationFramePresenter } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ArmPresentation";

import type { ManipulationController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationController";
import type { ManipulationInputCapture } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationInput";



import { composePose, linkPoses } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ModelKinematics";
import { ARM_PANEL_STYLE, PanelHeightAnimation } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";

import { ROBOT_LABEL_STYLE, WORLD_DASH_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";
import type { Vec3 } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { COLOR_WHITE, SnapOS2Styles, createRobotLabelText, setButtonStyle, uiMaterialLayer } from "../presentation/UIKit";

import { MarkerCorrectionRenderer } from "../presentation/MarkerCorrectionRenderer";

import { ManipulationControlsView } from "./ManipulationControlsView";
import { OPENYAM_MESH } from "./OpenYAMMesh";

type ManipulationState = ReadonlyFacts<MutableManipulationState>;
type ManipulationPose = ReadonlyFacts<MutableManipulationPose>;
type ClientTrackingOrigin = ReadonlyFacts<MutableClientTrackingOrigin>;

export const ARM_MATERIAL = requireAsset("../../../Materials/ArmFresnel.mat") as Material;


export function configureArmMaterial(material: Material, opacity = 1): void {
  const pass = material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number; twoSided: boolean };
  pass.fill = pass.edgeOpacity = ARM_VISUAL_STYLE.fill * opacity;
  // Negative power selects the flat surface branch; the measured sphere retains Fresnel.
  pass.power = -1;
  pass.twoSided = false;
}


export const ARM_SURFACE_MATERIAL = requireAsset("../../../Materials/ArmSurface.mat") as Material;

const surfaceValues = new WeakMap<Material, string>();

export function configureArmSurface(material: Material, opacity: number, color: number): void {
  const key = `${opacity}:${color}`;
  if (surfaceValues.get(material) === key) return;
  const pass = material.mainPass as any;
  pass.opacityScale = ARM_VISUAL_STYLE.fill * opacity;
  pass.colorR = ((color >> 16) & 255) / 255;
  pass.colorG = ((color >> 8) & 255) / 255;
  pass.colorB = (color & 255) / 255;
  surfaceValues.set(material, key);
}


const POINT_UNIFORMS = [
  "pointDelta00", "pointDelta01", "pointDelta02", "pointDelta10", "pointDelta11",
  "pointDelta12", "pointDelta20", "pointDelta21", "pointDelta22",
  "pointDeltaX", "pointDeltaY", "pointDeltaZ", "pointFloor", "pointBoost", "pointVisibility",
] as const;


/** Difference of rigid transforms, in the same centimetre basis as the static arm meshes. */
export function armDisplacementCoefficients(measured: ManipulationPose, proposed: ManipulationPose): number[] {
  return armTransformDifference(clientTrackingToSpecsPose(measured), clientTrackingToSpecsPose(proposed));
}


/** A constant-size fade replaces thousands of vertex-alpha edits and MeshBuilder rebuilds. */
export class ArmOpacityUniforms {
  private values = new Array<number>(POINT_UNIFORMS.length).fill(0);
  private target = new Array<number>(POINT_UNIFORMS.length).fill(0);
  private initialized = false;
  private readonly uploaded = new WeakMap<Material, number[]>();

  sample(measured: ManipulationPose, proposed: ManipulationPose,
    style: { pointVisible: boolean; floor: number; displacementBoost: number },
    refresh: boolean, elapsed: number): void {
    if (refresh || !this.initialized) {
      this.target.splice(0, 12, ...armDisplacementCoefficients(measured, proposed));
      // Begin at the current displacement; visibility itself fades in smoothly.
      if (!this.initialized) this.values.splice(0, 12, ...this.target.slice(0, 12));
      this.initialized = true;
    }
    this.target[12] = style.floor;
    this.target[13] = style.displacementBoost;
    this.target[14] = style.pointVisible ? 1 : 0;
    const gain = 1 - Math.exp(-Math.max(0, Math.min(0.1, elapsed)) / 0.12);
    for (let i = 0; i < this.values.length; i++) {
      const next = this.values[i] + (this.target[i] - this.values[i]) * gain;
      this.values[i] = Math.abs(next - this.target[i]) < 0.000001 ? this.target[i] : next;
    }
  }

  apply(material: Material): void {
    let previous = this.uploaded.get(material);
    if (!previous) { previous = []; this.uploaded.set(material, previous); }
    const pass = material.mainPass as unknown as Record<string, number>;
    POINT_UNIFORMS.forEach((name, i) => {
      if (previous[i] === this.values[i]) return;
      pass[name] = previous[i] = this.values[i];
    });
  }
}

const MATERIAL = requireAsset("../../../Materials/ArmStroke.mat") as Material;


/** Static link-local endpoints; only pose uniforms change during rigid motion. */
export class ArmStrokeRenderer extends AdaptiveStrokeRenderer {
  geometryUploads = 0;
  private boundsSet = false;
  private poseKey = "";
  private styleKey = "";
  constructor(parent: SceneObject, name: string) { super(parent, name, MATERIAL); }
  segments(...args: Parameters<AdaptiveStrokeRenderer["segments"]>): void {
    this.styleKey = "";
    super.segments(...args);
  }
  upload(vertices: number[], indices: readonly number[]): void {
    this.geometryUploads++;
    for (let i = 0; i < vertices.length; i += 22) {
      vertices[i + 15] = vertices[i + 11] * Math.hypot(vertices[i + 12] - vertices[i], vertices[i + 13] - vertices[i + 1], vertices[i + 14] - vertices[i + 2]);
    }
    if (!this.boundsSet && vertices.length) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < vertices.length; i += 22) for (const offset of [0, 12]) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertices[i + offset + axis]);
        max[axis] = Math.max(max[axis], vertices[i + offset + axis]);
      }
      const pass = this.material.mainPass as any;
      pass.frustumCullMode = FrustumCullMode.UserDefinedAABB;
      pass.frustumCullMin = new vec3(min[0] - 3, min[1] - 3, min[2] - 3);
      pass.frustumCullMax = new vec3(max[0] + 3, max[1] + 3, max[2] + 3);
      this.boundsSet = true;
    }
    super.upload(vertices, indices);
  }
  style(width: number, opacity: number, color: readonly [number, number, number] = [1, 1, 1], start = 0): void {
    const key = `${width}:${opacity}:${color}:${start}`;
    if (this.styleKey === key) return;
    super.style(width, opacity, color, start); this.styleKey = key;
  }
  pose(pose: ManipulationPose): void {
    const key = JSON.stringify(pose);
    if (key === this.poseKey) return;
    this.poseKey = key;
    const pass = this.material.mainPass as any;
    [pass.positionX, pass.positionY, pass.positionZ] = pose.position;
    [pass.rotationX, pass.rotationY, pass.rotationZ, pass.rotationW] = pose.orientation;
    const t = this.object.getTransform();
    t.setWorldPosition(new vec3(...pose.position));
    t.setWorldRotation(new quat(pose.orientation[3], pose.orientation[0], pose.orientation[1], pose.orientation[2]));
  }
}


export class EndEffectorStatusView {
  private readonly status = new EndEffectorStatus();
  private readonly presenter: ViewerNotificationPresenter;

  constructor(parent: SceneObject) {
    this.presenter = new ViewerNotificationPresenter(parent, {
      ...END_EFFECTOR_STATUS_STYLE, fontSize: 1.36 * 32 / 0.69492703,
    }, parent);
  }

  apply(input: EndEffectorStatusInput, anchor: SceneObject, camera: SceneObject, now: number): void {
    const sample = this.status.sample(input, now);
    this.presenter.draw(sample.notification, sample.elapsedS, sample.opacity, {
      plateAlpha: 0.94, warningColor: [1, 0.65, 0], neutralColor: [1, 1, 1],
    });
    if (!sample.notification) return;
    const rotation = camera.getTransform().getWorldRotation();
    const transform = this.presenter.root.getTransform();
    transform.setWorldPosition(anchor.getTransform().getWorldPosition().add(rotation.multiplyVec3(
      new vec3(END_EFFECTOR_STATUS_STYLE.rightM * 100, END_EFFECTOR_STATUS_STYLE.upM * 100, 0))));
    transform.setWorldRotation(rotation);
    transform.setLocalScale(vec3.one().uniformScale(sample.scale));
  }
}


export class ManipulationRenderer {
  private readonly placements = new Map<SceneObject, ManipulationPose>();
  private readonly pointOpacity = new Map<string, ArmOpacityUniforms>();
  readonly object: SceneObject;
  readonly controls: ManipulationControlsView;
  readonly handle: SceneObject;
  private readonly base: SceneObject;
  private readonly label: Text;
  private readonly nameLabel: Text;
  private readonly activityLabel: Text;
  private readonly sphere: WorldMeshRenderer;
  private readonly correction: MarkerCorrectionRenderer;
  localizationAvailable = false;
  private readonly warning: EndEffectorStatusView;
  private readonly picks = new Map<string, SceneObject>();
  private readonly meshes = new Map<string, WorldMeshRenderer>();
  private readonly edges = new Map<string, { stroke: ArmStrokeRenderer }>();
  private readonly path: AdaptiveStrokeRenderer;
  private readonly measured: WorldMeshRenderer;
  private readonly subscriptions: (() => void)[] = [];
  private readonly modelSubscriptions: (() => void)[] = [];
  private readonly hoverSources = new Set<string>();
  private readonly handleHover = new Set<string>();
  private readonly actionHover = new Set<string>();
  private readonly framePresenter: ManipulationFramePresenter;
  private readonly menuHeight = new PanelHeightAnimation();
  private menuRows = "";
  private modelRevision = "";
  private uploadedPath = "";
  private lastTime = 0;
  private hoverUntil = 0;
  private hoverProgress = 0;
  private controlsEnabled = false;
  private readonly meshFade = new ArmMeshFade();
  private readonly opacityCadence = new ArmOpacityCadence();
  private readonly fillFade = new ArmMeshFade();
  debugEnabled = false;
  private readonly debugNodes = new Map<string, {axes: AdaptiveStrokeRenderer[]; label: Text}>();

  constructor(parent: SceneObject, private readonly core: ManipulationController,
    private readonly capture: ManipulationInputCapture, recalibrate: () => void = () => {}) {
    this.framePresenter = new ManipulationFramePresenter(core.presentation);
    this.object = this.node(parent, "Manipulation");
    this.handle = this.node(this.object, "EndEffectorHandle");
    const geometry = sphereMesh(0.9, 20, 16);
    this.sphere = new WorldMeshRenderer(this.handle, "EndEffectorSphere", ARM_MATERIAL);
    configureArmMaterial(this.sphere.material);
    (this.sphere.material.mainPass as Pass & { fill: number }).fill = 0.75;
    const handleGeometry = sphereMesh(1.2, 20, 16);
    this.sphere.triangles(handleGeometry.positions, handleGeometry.indices, [0.82, 0.82, 0.82, 1], undefined, handleGeometry.normals);
    this.correction = new MarkerCorrectionRenderer(this.object, this.sphere);
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
    this.controls = new ManipulationControlsView(this.object, core, () => this.controlsEnabled,
      (key, active) => { if (active) this.actionHover.add(key); else this.actionHover.delete(key); }, recalibrate);
    this.menuHeight.request(4 * ARM_PANEL_STYLE.rowM + ARM_PANEL_STYLE.paddingM + ARM_PANEL_STYLE.headerM, true);
    this.warning = new EndEffectorStatusView(this.object);
  }


  private node(parent: SceneObject, name: string): SceneObject {
    const object = global.scene.createSceneObject(name); object.setParent(parent); return object;
  }
  pressEndEffectorAction(object: SceneObject, sourceId: string): boolean {
    let target: SceneObject | null = object;
    while (target && target !== this.controls.gripper.sceneObject) target = target.getParent();
    if (!target) return false;
    const intent = this.core.interaction.snapshot();
    if (!this.controlsEnabled || this.controls.gripper.button.inactive) return true;
    if (intent.canManipulate && this.capture.pressGripper(sourceId)) this.core.action("gripper");
    return true;
  }
  ownsMesh(object: SceneObject): boolean { return object === this.base || [...this.picks.values()].includes(object); }
  ownsHandle(object: SceneObject): boolean { return object === this.handle; }

  apply(input: {
    state: ManipulationState | null | undefined;
    origin: ClientTrackingOrigin | null;
    selected: boolean;
    enabled: boolean;
    now: number;
    camera: SceneObject;
    title: string;
  }): void {
    const { state, origin, selected, enabled, now, camera, title } = input;
    if(this.core.interaction.retainingFeedback && origin) {
      this.framePresenter.hold(now);
      this.controlsEnabled = false;
      for (const [key, button] of this.controls.buttons) button.button.inactive = key !== "estop" && key !== "stop";
      this.controls.gripper.button.inactive = true; this.controls.speed.enabled = false;
      if(this.core.interaction.target) this.place(this.handle,this.core.interaction.target,origin);
      this.correction.update(this.handle.enabled ? origin : null, now);
      this.warning.apply({ blocked: false, fresh: false, stopped: false, moving: false,
        rejection: null }, this.handle, camera, now);
      this.activityLabel.text="No feedback"; return;
    }
    this.controlsEnabled = enabled;
    this.object.enabled = !!origin && enabled;
    if (!this.object.enabled || !state?.available || !state.model || !origin) {
      this.object.enabled = !!origin && enabled && this.modelRevision !== "";
      this.framePresenter.reset();
      this.meshFade.reset(); this.measured.object.enabled = false;
      this.handle.enabled = false; this.controls.previewMenu.enabled = false; this.controls.gripper.sceneObject.enabled = false;
      this.correction.reset();
      for (const mesh of this.meshes.values()) mesh.object.enabled = false;
      for (const pick of this.picks.values()) pick.enabled = false;
      for (const edge of this.edges.values()) edge.stroke.hide();
      this.path.hide();
      this.warning.apply({ blocked: false, fresh: false, stopped: false, moving: false,
        rejection: null }, this.handle, camera, now);
      this.controlsEnabled = false;
      for (const [key, button] of this.controls.buttons) button.button.inactive = key === "estop" ? !(this.core.interaction.snapshot().canStop || this.core.interaction.snapshot().canResume) : key !== "stop" || !this.core.interaction.snapshot().canStop;
      this.controls.speed.enabled = false;
      return;
    }
    const model = state.model;
    const interaction = this.core.interaction;
    const intent = interaction.snapshot();
    const dt = this.lastTime ? Math.max(0, Math.min(0.1, now - this.lastTime)) : 1 / 60;
    this.lastTime = now;
    const frame = this.framePresenter.sample({
      model, state, groupId: interaction.groupId, origin, now, selected, intent,
      target: interaction.target, solution: interaction.previewJoints, plan: interaction.plan,
      desiredGripper: interaction.desiredGripper,
      rejection: interaction.rejection,
    });
    const { group, observed, root, observedValues, measured: measuredPoses,
      proposed: poses, displaced, playback, endEffectorPose: displayedPose } = frame;
    const markerAction = endEffectorAction(intent,
      selected ? interaction.desiredGripper ?? observed?.gripper_target ?? observed?.gripper : observed?.gripper,
      group?.has_gripper === true);
    if (this.modelRevision !== model.revision) {
      for (const unsubscribe of this.modelSubscriptions) unsubscribe(); this.modelSubscriptions.length = 0;
      for (const mesh of this.meshes.values()) mesh.destroy(); this.meshes.clear();
      for (const { stroke } of this.edges.values()) stroke.destroy(); this.edges.clear();
      for (const pick of this.picks.values()) pick.destroy(); this.picks.clear(); this.hoverSources.clear();
      this.pointOpacity.clear(); this.placements.clear();
      this.modelRevision = model.revision;
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
        this.pointOpacity.set(link.name, new ArmOpacityUniforms());
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
        stroke.segments(points.map(clientTrackingToSpecsPoint), STYLE.widthM * 100, 1,
          STYLE.dashM * 100, STYLE.gapM * 100, false);
        this.edges.set(link.name, { stroke });
      }
    }
    const world = (pose: ManipulationPose): ManipulationPose => clientTrackingToSpecsPose(odomToClientTrackingPose(pose, origin));
    this.meshFade.beginFrame(now, `${model.revision}:${interaction.groupId}`);
    const opacityElapsed = this.opacityCadence.sample(now);
    const sampleOpacity = opacityElapsed !== null;
    this.fillFade.beginFrame(now, `${model.revision}:${interaction.groupId}`);
    for (const link of model.links) {
      const pose = composePose(root, poses[link.name]);
      const style = armLinkPresentation({ selected, hovered: this.hoverSources.size > 0, dragging: intent.dragging,
        finishing: intent.finishing === true, displaced, playing: playback.playing,
        weight: displaced ? 1 : armLinkWeight(measuredPoses[link.name], poses[link.name]), failed: interaction.rejection !== null,
        failedLink: model.joints.some(j => j.child === link.name && interaction.rejection?.failedJoints?.includes(j.name)) });
      const alpha = this.meshFade.sample(link.name, style.visible ? style.alpha : 0);
      const fillAlpha = this.fillFade.sample(link.name, style.showFill ? style.alpha : 0);
      const pointOpacity = this.pointOpacity.get(link.name);
      pointOpacity?.sample(measuredPoses[link.name], poses[link.name], style, sampleOpacity, dt);
      const visible = alpha > 0.0001;
      const mesh = this.meshes.get(link.name);
      if (mesh) {
        configureArmSurface(mesh.material, fillAlpha, style.color);
        pointOpacity?.apply(mesh.material);
        mesh.object.enabled = fillAlpha > 0.0001;
        if (mesh.object.enabled) this.place(mesh.object, pose, origin);
      }
      const edge = this.edges.get(link.name);
      if (edge) {
        const color: Vec3 = [((style.color >> 16) & 255) / 255, ((style.color >> 8) & 255) / 255, (style.color & 255) / 255];
        pointOpacity?.apply(edge.stroke.material);
        if (!visible) { edge.stroke.hide(); }
        else {
          edge.stroke.object.enabled = true;
          edge.stroke.pose(world(pose));
          edge.stroke.style(style.widthM * 100, STYLE.opacity * alpha, color);
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
      this.controls.gripper.sceneObject.enabled = markerAction.available && !state.stopped && (!intent.dragging || markerAction.allowDuringGrab) && this.hoverProgress > 0.01;
      this.controls.gripper.sceneObject.getTransform().setLocalScale(new vec3(1, 1, 1).uniformScale(Math.max(0.01, this.hoverProgress)));
      this.controls.gripper.sceneObject.getTransform().setWorldPosition(p.add(new vec3(0, -5, 0)));
      this.controls.gripper.sceneObject.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
      this.controls.previewMenu.enabled = selected && !intent.dragging && !state.stopped && this.hoverProgress > 0.01;
      this.controls.previewMenu.getTransform().setLocalScale(new vec3(1,1,1).uniformScale(Math.max(0.01, this.hoverProgress)));
      this.controls.previewMenu.getTransform().setWorldPosition(p.add(new vec3(0, 5, 0)));
      this.controls.previewMenu.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    }
    this.controls.gripper.labelText.text = markerAction.label;
    this.controls.gripper.button.inactive = !markerAction.enabled;
    setButtonStyle(this.controls.gripper.button, SnapOS2Styles.Secondary);
    this.place(this.base, root, origin); this.base.getTransform().setWorldRotation(camera.getTransform().getWorldRotation());
    this.nameLabel.text = title;
    this.controls.panelTitle.text = title.length > 15 ? `${title.slice(0,14)}…` : title;
    this.controls.rescan.sceneObject.enabled = this.localizationAvailable;
    if(this.controls.scanIcon) this.controls.scanIcon.object.enabled = this.localizationAvailable;
    this.controls.rescan.button.inactive = intent.executing || intent.dragging || intent.resetting;
    this.activityLabel.text = intent.activity + (model.visual_signature !== OPENYAM_MESH.signature ? " · Preview mesh unavailable" : "");
    this.label.text = `Movement speed ${Math.round(interaction.speedScale * 100)}%`;
    this.sphere.setColor(intent.blocked || interaction.rejection
      ? [((STYLE.warningColor >> 16) & 255) / 255, ((STYLE.warningColor >> 8) & 255) / 255, (STYLE.warningColor & 255) / 255, 1]
      : [0.82, 0.82, 0.82, 1]);
    this.correction.update(this.handle.enabled ? origin : null, now);

    this.controls.speedLabel.text = `Speed · ${Math.round(interaction.speedScale * 100)}%`;
    const speedValue = (interaction.speedScale - 0.05) / 0.95;
    if (this.controls.speed.currentValue !== speedValue) {
      this.controls.syncingSpeed = true; this.controls.speed.currentValue = speedValue; this.controls.syncingSpeed = false;
    }
    this.controls.speed.enabled = intent.canManipulate;
    const rows = manipulationMenuRows();
    this.menuHeight.request((rows.length-1) * ARM_PANEL_STYLE.rowM + ARM_PANEL_STYLE.paddingM + ARM_PANEL_STYLE.headerM); this.menuHeight.tick(dt);
    this.controls.panelPresenter.update(state.root_pose ? this.base : null, camera, this.menuHeight.height);
    const menuRows = rows.join(":");
    if (menuRows !== this.menuRows) rows.forEach(key => {
      const i = key === "stop" || key === "reset" ? 0 : key === "speed" ? 1 : 2;
      const node = key === "speed" ? this.controls.speed.getSceneObject() : this.controls.buttons.get(key)!.sceneObject;
      node.getTransform().setLocalPosition(new vec3(key === "reset" ? 5.3 : key === "stop" ? -5.3 : 0, -ARM_PANEL_STYLE.headerM*100-2.8-i*4-(key === "speed" ? 1 : i>1 ? 1.2 : 0),.8));
    });
    this.menuRows = menuRows;
    for (const [key, button] of this.controls.buttons) {
      if (key !== "plan" && key !== "execute") button.sceneObject.enabled = rows.includes(key);
      button.button.inactive = !manipulationButtonEnabled(key, intent);
    }
    const emergency = this.controls.buttons.get("estop")!;
    emergency.labelText.text = state.stopped ? "Resume operation" : "E-stop";
    setButtonStyle(emergency.button, state.stopped ? SnapOS2Styles.Primary : SnapOS2Styles.Special);
    this.warning.apply(frame.status, this.handle, camera, now);
    const points = frame.path.visible ? frame.path.points.map(position => world({
      position, orientation: [0, 0, 0, 1],
    }).position) : [];
    const geometryKey = JSON.stringify([frame.path.revision, origin, frame.path.visible]);
    if (geometryKey !== this.uploadedPath) {
      this.uploadedPath = geometryKey;
      this.path.segments(points.slice(0, -1).flatMap((point, i) => [point, points[i + 1]]),
        WORLD_DASH_STYLE.widthM * 65, 1, 1.2, 1, true);
    }
    this.path.object.enabled = points.length >= 2;
    this.path.style(WORLD_DASH_STYLE.widthM * 65, frame.pathOpacity, [1, 1, 1], frame.path.startDistanceM * 100);
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
    this.placements.clear(); this.controls.dispose();
    for (const unsubscribe of this.modelSubscriptions) unsubscribe();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    for (const pick of this.picks.values()) pick.destroy();
    this.object.destroy();
  }
}
