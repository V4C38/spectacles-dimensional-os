import type { ReadonlyFacts } from "@dimos-ar-client/ClientContracts";
import * as THREE from "three";
import { indicatorMaterial } from "../presentation/PoseIndicatorMaterial";
import { registerRayTarget } from "../input/WebXRInteraction";
import { EndEffectorStatusView } from "../presentation/NotificationPill";
import { endEffectorAngles, ARM_VISUAL_STYLE, armPointDisplacement, armLinkWeight, armLinkPresentation, ArmMeshFade, ManipulationPreviewPlayback, type ManipulationSnapshot } from "@dimos-ar-client/manipulation/ManipulationPresentation";

import { ARM_PANEL_STYLE } from "@dimos-ar-client/presentation/ControlPanelPresentation";
import { ManipulationFramePresenter } from "@dimos-ar-client/manipulation/ArmPresentation";
import { Text } from "troika-three-text";
import { disposeTextResources, UI_FONT_REGULAR, syncText } from "../presentation/SceneResources";

import { ROBOT_LABEL_STYLE, WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldPresentation";
import { webxrToClientTrackingPoint, clientTrackingToWebxrPose } from "../utilities/WebXRCoordinates";


import { type ClientTrackingOrigin as MutableClientTrackingOrigin, odomToClientTrackingPose } from "@dimos-ar-client/localization/ClientTracking";


import type { ManipulationPlan as MutableManipulationPlan, ManipulationPose as MutableManipulationPose, ManipulationState as MutableManipulationState } from "@dimos-ar-client/manipulation/ManipulationTypes";
import { composePose, linkPoses } from "@dimos-ar-client/manipulation/ModelKinematics";

import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";



import { ManipulationControlsView } from "./ManipulationControlsView";
import { ManipulationModelRenderer } from "./ManipulationModelRenderer";
import { MarkerCorrectionRenderer } from "../presentation/MarkerCorrectionRenderer";

type ManipulationState = ReadonlyFacts<MutableManipulationState>;
type ManipulationPlan = ReadonlyFacts<MutableManipulationPlan>;
type ManipulationPose = ReadonlyFacts<MutableManipulationPose>;
type ClientTrackingOrigin = ReadonlyFacts<MutableClientTrackingOrigin>;

/** Tool interaction stays on top; environment depth never modifies this material. */
export class EndEffectorHandleRenderer {
  readonly object = new THREE.Group();
  readonly collider: THREE.Mesh;
  readonly visual: THREE.Mesh;
  constructor() {
    this.object.name = "EndEffectorHandle";
    this.collider = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 20, 16),
      indicatorMaterial(),
    );
    this.visual = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 16), this.collider.material);
    this.visual.renderOrder = 50;
    this.visual.raycast = () => {};
    this.object.add(this.visual);
    this.collider.material = new THREE.MeshBasicMaterial({ visible: false });
    this.collider.name = "EndEffectorHandleCollider";
    this.collider.userData.rayPriority = 10;
    registerRayTarget(this.collider);
    this.collider.renderOrder = 50;
    this.object.add(this.collider);

  }
  dispose(): void {
    this.object.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          material.dispose();
      }
    });
    this.object.removeFromParent();
  }
}


export interface ManipulationRenderInput {
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
    failedJoints?: readonly string[];
  } | null;
}


export class ManipulationRenderer {
  readonly object = new THREE.Group();
  debugEnabled = false;
  private readonly debugNodes = new Map<string, {node: THREE.Group; label: Text}>();
  private readonly modelRenderer = new ManipulationModelRenderer();
  readonly controlsView = new ManipulationControlsView();
  readonly panel = this.controlsView.controls;
  readonly baseMarker = this.controlsView.baseMarker;
  readonly gripperMenu = this.controlsView.gripperMenu;
  readonly previewMenu = this.controlsView.previewMenu;
  readonly speedSlider = this.controlsView.speedSlider;
  readonly handle = new EndEffectorHandleRenderer();
  private readonly correction = new MarkerCorrectionRenderer(this.handle.visual);
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
  private readonly pointFade = new ArmMeshFade();
  private readonly cachedPoints = new WeakMap<object, Float32Array>();
  private clientPoints(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
    let points = this.cachedPoints.get(attribute);
    if (!points) {
      points = new Float32Array(attribute.count * 3);
      for (let i = 0; i < attribute.count; i++) points.set(webxrToClientTrackingPoint([attribute.getX(i),attribute.getY(i),attribute.getZ(i)]),i*3);
      this.cachedPoints.set(attribute, points);
    }
    return points;
  }
  private readonly fillFade = new ArmMeshFade();
  readonly measuredHandle = new EndEffectorHandleRenderer();
  get previewRequested(): boolean { return this.preview.previewRequested; }
  set previewRequested(value: boolean) {
    this.preview.setRequested(value);
  }
  readonly viewerPosition = new THREE.Vector3();
  handDragging = false;
  private readonly basePosition = new THREE.Vector3();
  private readonly framePresenter: ManipulationFramePresenter;
  readonly statusView = new EndEffectorStatusView();
  pinned = false;
  eeHovered = false;
  hoveredAction: string | null = null;
  hoveredLink: string | null = null;
  constructor(private readonly preview = new ManipulationPreviewPlayback()) {
    this.framePresenter = new ManipulationFramePresenter(preview);
    this.object.name = "Manipulation";
    this.path.userData.environmentDepth = true;
    this.path.raycast = () => {};
    this.object.add(this.statusView.object);
    (this.handle.visual.material as THREE.Material).transparent = true;
    (this.handle.visual.material as THREE.Material).depthWrite = false;
    this.handle.collider.scale.setScalar(1.04);
    this.handle.visual.scale.setScalar(1.04);
    this.measuredHandle.collider.userData.interactionEnabled = false;
    this.measuredHandle.collider.raycast = () => {};
    this.measuredHandle.visual.scale.setScalar(0.52);
    this.measuredHandle.visual.renderOrder = 51;
    (
      this.measuredHandle.visual.material as THREE.ShaderMaterial
    ).uniforms.uOpacity.value = 0.30;
    const measuredMaterial = this.measuredHandle.visual.material as THREE.ShaderMaterial;
    measuredMaterial.transparent = true; measuredMaterial.depthWrite = false; measuredMaterial.depthTest = false;
    measuredMaterial.uniforms.uFill.value = 1;
    measuredMaterial.uniforms.uRim.value = 0;
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
    this.viewerPosition.copy(position);
    this.controlsView.faceViewer(position);
    this.statusView.faceViewer(position);
    for (const { label } of this.debugNodes.values()) label.lookAt(position);
  }
  resetPanel(): void {
    this.baseMarker.attach(this.panel);
    this.panel.position.set(0,-0.13,0);
    this.panel.quaternion.identity();
    this.panel.scale.setScalar(ARM_PANEL_STYLE.defaultScale);
    this.pinned = false;
  }
  detachPanel(): void { this.object.attach(this.panel); this.pinned = true; }

  owns(object: THREE.Object3D): boolean {
    return (
      object === this.handle.collider ||
      !!object.userData.manipulationLink ||
      !!object.userData.manipulationPanel ||
      !!object.userData.manipulationControl ||
      !!object.userData.manipulationAction
    );
  }
  apply(input: ManipulationRenderInput): void {
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
    const recorded = state?.read_only === true;
    this.modelRenderer.tick(now, (fresh || recorded) && !!state?.available && !!origin);
    if (intent.retainingFeedback && origin && !recorded) {
      this.framePresenter.hold(now);
      for (const [key, button] of this.controlsView.buttons) button.setEnabled(key === "estop" || key === "stop");
      this.speedSlider.hit.userData.interactionEnabled = false;
      if(target) this.place(this.handle.object,target,origin);
      this.correction.update(this.handle.object.visible ? origin : null, now);
      this.statusView.update(this.handle.object.position, now, { blocked: false, fresh: false,
        stopped: intent.stopped, moving: false, rejection: null });
      this.statusView.faceViewer(this.viewerPosition);
      this.controlsView.baseLabel.setFeedback(robotTitle,"No feedback",`Movement speed ${Math.round(input.speedScale*100)}%`,0xff9f0a);
      return;
    }
    this.object.visible = !!origin && (!!state?.available || this.modelRenderer.model !== null);
    if (!state?.available || !state.model || !origin) {
      this.framePresenter.reset();
      this.previewRequested = false;
      this.meshFade.reset();
      this.measuredHandle.object.visible = false;
      this.handle.object.visible = false; this.handle.collider.userData.interactionEnabled = false;
      this.correction.reset();
      this.gripperMenu.visible = this.previewMenu.visible = this.path.visible = false;
      for (const node of this.modelRenderer.previewMeshes.values()) node.visible = false;
      for (const node of this.modelRenderer.ghosts.values()) node.visible = false;
      this.controlsView.baseLabel.setFeedback(robotTitle, "No feedback", `Movement speed ${Math.round(input.speedScale * 100)}%`, 0xff9f0a);
      for (const [key, button] of this.controlsView.buttons) button.setEnabled(key === "estop" ? intent.canStop || intent.canResume : key === "stop" && intent.canStop);
      this.speedSlider.hit.userData.interactionEnabled = false;
      this.statusView.update(this.handle.object.position, now, { blocked: false, fresh: false,
        stopped: intent.stopped, moving: false, rejection: null });
      this.statusView.faceViewer(this.viewerPosition);
      return;
    }
    if (this.modelRenderer.model?.revision !== state.model.revision) {
      this.modelRenderer.rebuild(state.model);
      this.pathKey = "";
      this.framePresenter.reset();
    }
    const model = state.model;
    const frame = this.framePresenter.sample({
      model, state, groupId, origin, now, selected, intent, target, solution, plan,
      desiredGripper: input.desiredGripper,
      rejection: input.rejection,
    });
    const { observed, group, root: rootPose, displaced,
      measured, proposed: preview, observedValues: all } = frame;
    const dragging = intent.dragging;
    const playing = frame.playback.playing;
    const base = clientTrackingToWebxrPose(odomToClientTrackingPose(rootPose, origin));
    this.basePosition.fromArray(base.position);
    this.baseMarker.position.copy(this.basePosition);
    this.controlsView.baseLabel.setFeedback(robotTitle, intent.activity,
      `Movement speed ${Math.round(input.speedScale * 100)}%`,
      !fresh ? 0xff9f0a : state.stopped ? 0xff453a : 0x30d158);
    const dtOutline = Math.max(0, Math.min(0.1, now - this.lastFrameTime));
    this.lastFrameTime = now;
    for (const [name, ghost] of this.modelRenderer.ghosts) {
      ghost.visible = fresh;
      this.place(ghost, composePose(rootPose, preview[name]), origin);
    }
    this.meshFade.beginFrame(now, `${model.revision}:${groupId}`);
    this.pointFade.beginFrame(now, `${model.revision}:${groupId}`);
    this.fillFade.beginFrame(now, `${model.revision}:${groupId}`);
    for (const [name, ghost] of this.modelRenderer.previewMeshes) {
      const style = armLinkPresentation({ selected: selected || recorded, hovered: this.hoveredLink !== null, dragging,
        finishing: intent.finishing === true, displaced, playing, weight: displaced ? 1 : armLinkWeight(measured[name], preview[name]),
        failed: input.rejection !== null, failedLink: model.joints.some(j => j.child === name && input.rejection?.failedJoints?.includes(j.name)) });
      const alpha = this.meshFade.sample(name, style.visible ? style.alpha : 0);
      const fillAlpha = this.fillFade.sample(name, style.showFill ? style.alpha : 0);
      const pointWeight = armPointDisplacement(measured[name], preview[name]);
      ghost.visible = alpha > 0.0001;
      ghost.traverse(part => {
        if (!(part instanceof THREE.Mesh)) return;
        const material = part.material as THREE.ShaderMaterial;
        if (part.userData.armOutline) {
          const geometry = part.geometry;
          const starts = geometry.getAttribute("instanceStart"), ends = geometry.getAttribute("instanceEnd"), weights = geometry.getAttribute("instanceOpacity");
          if (starts && ends && weights) {
            const a = this.clientPoints(starts), b = this.clientPoints(ends);
            const initial = geometry.userData.armWeightsInitialized !== true;
            let changed = initial;
            for (let i = 0; i < starts.count; i++) {
              const previousA = initial ? 0 : weights.getX(i), previousB = initial ? 0 : weights.getY(i);
              const nextA = this.pointFade.sampleValue(previousA, style.pointVisible ? (style.floor + Math.max(0, pointWeight(a[i*3],a[i*3+1],a[i*3+2]) - style.floor) * style.displacementBoost) : 0);
              const nextB = this.pointFade.sampleValue(previousB, style.pointVisible ? (style.floor + Math.max(0, pointWeight(b[i*3],b[i*3+1],b[i*3+2]) - style.floor) * style.displacementBoost) : 0);
              if (nextA !== previousA || nextB !== previousB || initial) { weights.setXY(i,nextA,nextB); changed = true; }
            }
            geometry.userData.armWeightsInitialized = true;
            if (changed) weights.needsUpdate = true;
          }
          material.uniforms.uOpacity.value = ARM_VISUAL_STYLE.opacity * alpha;
          material.uniforms.uWidth.value = style.widthM;
          material.uniforms.uColor.value.setHex(style.color);
        } else {
          const positions = part.geometry.getAttribute("position");
          let weights = part.geometry.getAttribute("armAlpha");
          if (!weights) { weights = new THREE.Float32BufferAttribute(new Float32Array(positions.count), 1); part.geometry.setAttribute("armAlpha", weights); }
          const points = this.clientPoints(positions);
          let changed = false;
          for (let i = 0; i < positions.count; i++) {
            const previous = weights.getX(i);
            const next = this.pointFade.sampleValue(previous, style.pointVisible ? (style.floor + Math.max(0, pointWeight(points[i*3],points[i*3+1],points[i*3+2]) - style.floor) * style.displacementBoost) : 0);
            if (next !== previous) { weights.setX(i,next); changed = true; }
          }
          if (changed) weights.needsUpdate = true;
          material.uniforms.uOpacity.value = fillAlpha;
          material.uniforms.uColor.value.setHex(style.color);
        }
      });
      if (preview)
        this.place(ghost, composePose(rootPose, preview[name]), origin);
    }
    this.handle.collider.userData.interactionEnabled = intent.canManipulate;
    this.path.visible = frame.path.visible && !!group?.tip_frame;
    this.pathStroke.setStyle(WORLD_DASH_STYLE.widthM * 0.65, frame.pathOpacity);
    const pathKey = JSON.stringify([frame.path.revision, origin]);
    if (pathKey !== this.pathKey) {
      this.pathKey = pathKey;
      const points = frame.path.points.map(position => clientTrackingToWebxrPose(
        odomToClientTrackingPose({ position, orientation: [0, 0, 0, 1] }, origin)).position);
      this.pathStroke.setSegments(points.slice(0, -1).flatMap((point, i) => [point, points[i + 1]]), true);
    }
    const targetMaterial = this.handle.visual.material as THREE.ShaderMaterial;
    targetMaterial.uniforms.uCenterColor.value.setHex(intent.blocked || !fresh || input.rejection ? ARM_VISUAL_STYLE.warningColor : 0xb3b3b3);
    targetMaterial.uniforms.uRimColor.value.setHex(intent.blocked || input.rejection ? ARM_VISUAL_STYLE.warningColor : 0xffffff);
    this.measuredHandle.object.visible = !!observed?.pose;
    if (observed?.pose)
      this.place(this.measuredHandle.object, observed.pose, origin);
    (
      this.handle.visual.material as THREE.ShaderMaterial
    ).uniforms.uOpacity.value = 0.75;
    this.handle.object.visible = !!observed?.pose;
    if (observed?.pose)
      this.place(
        this.handle.object,
        frame.endEffectorPose!,
        origin,
      );

    this.correction.update(this.handle.object.visible ? origin : null, now);
    for (const {node} of this.debugNodes.values()) node.visible = false;
    if (this.debugEnabled) {
      const debug = (name: string, pose: ManipulationPose | null | undefined, angle?: number | string) => {
        if (!pose) return;
        let entry = this.debugNodes.get(name);
        if (!entry) {
          const node = new THREE.Group(), axes = new THREE.AxesHelper(0.04), label = new Text();
          // Axes are authored in client coordinates and converted with the pose.
          const positions = axes.geometry.getAttribute("position");
          for (let i = 0; i < positions.count; i++) { const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i); positions.setXYZ(i, -y, z, -x); }
          axes.raycast = () => {};
          for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) {material.depthTest = material.depthWrite = false;}
          label.font = UI_FONT_REGULAR; label.fontSize = ROBOT_LABEL_STYLE.detail.emM;
          label.color = 0xaeaeb2; label.anchorX = "center"; label.position.y = 0.045;
          label.raycast = () => {}; node.add(axes, label); this.object.add(node);
          entry = {node, label}; this.debugNodes.set(name, entry);
        }
        entry.node.visible = true; this.place(entry.node, pose, origin);
        const value = angle == null ? "" : typeof angle === "string" ? angle : `${name} ${(angle * 180 / Math.PI).toFixed(1)}°`;
        if (entry.label.text !== value) {entry.label.text = value; syncText(entry.label);}
      };
      debug("base", rootPose); debug("current-ee", observed?.pose, observed?.pose ? endEffectorAngles(rootPose, observed.pose) : undefined); debug("target-ee", target ?? observed?.pose, (target ?? observed?.pose) ? endEffectorAngles(rootPose, (target ?? observed?.pose)!) : undefined);
      const rawPoses = linkPoses(model, all);
      for (const joint of model.joints) if (["revolute", "continuous"].includes(joint.kind) && all[joint.name] != null)
        debug(joint.name, composePose(rootPose, rawPoses[joint.child]), all[joint.name]);
    }
    this.pathStroke.setStartDistance(frame.path.startDistanceM);
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
    this.statusView.update(
      this.handle.object.position,
      now,
      frame.status,
    );
    this.statusView.faceViewer(this.viewerPosition);

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
    this.correction.dispose();
    for (const {node, label} of this.debugNodes.values()) { disposeTextResources(label); node.traverse(n => { if (n instanceof THREE.LineSegments) {n.geometry.dispose(); for (const m of Array.isArray(n.material) ? n.material : [n.material]) m.dispose();} }); node.removeFromParent(); }
    this.debugNodes.clear();
    this.modelRenderer.dispose();
    this.controlsView.dispose();
    this.pathStroke.dispose();
    this.handle.dispose();
    this.measuredHandle.dispose();
    this.statusView.dispose();
    this.object.removeFromParent();
  }
}
