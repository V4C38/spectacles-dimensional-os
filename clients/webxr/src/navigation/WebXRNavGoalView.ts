import { NAVIGATION_OUTCOME_STYLE, strokeJoints2D, STROKE_JOIN_SEGMENTS, WORLD_DASH_STYLE, circleStrokeSegments, NAVIGATION_CANCEL_STYLE, navigationCancelReveal, NAVIGATION_PREVIEW_ARROW_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import * as THREE from "three";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import { NAV_FEEDBACK_ANIMATION_S, NAV_FEEDBACK_TIMING } from "@dimos-ar-client/navigation/NavigationInteraction";
import { DIMOS_AR_DESIGN, FLOOR_MARKER_STYLE } from "../presentation/DimOSARDesign";
import { Text } from "troika-three-text";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { disposeTextResources } from "../presentation/TextResources";
import { GlassSurface } from "../presentation/GlassSurface";
import { buttonSurfaceBacking, tintButtonBacking } from "../presentation/RoundedSurfaceGeometry";
import { syncText, UI_FONT_SEMIBOLD } from "../presentation/UIFonts";

import type { NavFlash } from "@dimos-ar-client/navigation/NavigationInteraction";
export type { NavFlash } from "@dimos-ar-client/navigation/NavigationInteraction";

const MARKER_COLOR = 0xffffff;
const IDLE_OPACITY = FLOOR_MARKER_STYLE.idleOpacity;
const FLASH_COLORS: Record<NavFlash, number> = { succeeded: 0x30d158, cancelled: 0xff453a, failed: 0xff9f0a };
const GOAL_RADIUS_M = FLOOR_MARKER_STYLE.radiusM;
const CANCEL_DIAMETER_M = 0.12;

export class WebXRNavGoalView {
  readonly object: THREE.Group;
  readonly probe = new THREE.Group();
  private readonly outcomeRing = new THREE.Mesh(new THREE.RingGeometry(GOAL_RADIUS_M - FLOOR_MARKER_STYLE.strokeM, GOAL_RADIUS_M, 128), markerMaterial());
  private readonly outcomeGlyph = new THREE.Group();
  private readonly outcomeJoin = new THREE.Mesh(new THREE.CircleGeometry(NAVIGATION_OUTCOME_STYLE.glyphWidthM / 2, STROKE_JOIN_SEGMENTS), markerMaterial());
  private readonly outcomeStrokes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private feedbackProgress = 0;
  readonly cancelObject: GlassSurface;
  private readonly cancelBacking: ReturnType<typeof buttonSurfaceBacking>;
  private readonly cancelRoot = new THREE.Group();
  private readonly cancelLabel: Text;
  private readonly glyph: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly disc: THREE.Mesh;
  private readonly arrow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly discMaterial: THREE.MeshBasicMaterial;
  private readonly arrowMaterial: THREE.MeshBasicMaterial;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly glyphMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false });

  private readonly visuals = new THREE.Group();
  private readonly connectorRenderer = new AdaptiveDashedLineRenderer();
  private readonly draftCircleRenderer = new AdaptiveDashedLineRenderer();
  private readonly connector = this.connectorRenderer.object;
  private readonly probeStem = new AdaptiveDashedLineRenderer();
  private readonly probeCircleRenderer = new AdaptiveDashedLineRenderer();
  private cancelRequested = false;
  private cancelProgress = 0;
  private cancelConfirmationId = 0;

  private selected = false;
  private hovered = false;
  private dragging = false;
  private following = false;
  private opacity: number = IDLE_OPACITY;
  private visualScale = 1;
  private pulseTime = 0;
  private motion = 0;
  private aiming = false;
  private flash: NavFlash | null = null;

  constructor(private readonly radiusM: number = GOAL_RADIUS_M) {
    this.object = new THREE.Group();
    this.object.name = "WebXRNavGoalView";
    this.discMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(this.radiusM + 0.0016, this.radiusM + 0.0016, 0.018, 48), this.discMaterial);
    this.disc.name = "Navigation hit surface";
    this.arrowMaterial = markerMaterial();
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.1); arrow.lineTo(-0.05, 0.02); arrow.lineTo(-0.014, 0.02);
    arrow.lineTo(-0.014, -0.085); arrow.lineTo(0.014, -0.085);
    arrow.lineTo(0.014, 0.02); arrow.lineTo(0.05, 0.02); arrow.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrow), this.arrowMaterial);
    this.arrow.name = "NavigationHeading";
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.position.set(0, 0.023, 0);
    this.arrow.scale.setScalar(1.3 * this.radiusM / GOAL_RADIUS_M);
    this.ringMaterial = markerMaterial();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(this.radiusM - FLOOR_MARKER_STYLE.strokeM, this.radiusM, 128), this.ringMaterial);
    this.ring.name = "NavigationCircle";
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;

    this.cancelObject = new GlassSurface({ width: CANCEL_DIAMETER_M, height: CANCEL_DIAMETER_M, radius: CANCEL_DIAMETER_M / 2, tint: "#ff453a", alpha: 1, rim: 0.12, rimWidth: 0.002 });
    this.cancelObject.name = "WebXRNavGoalCancel";
    const cancelThickness = (DIMOS_AR_DESIGN.depth.secondary + DIMOS_AR_DESIGN.depth.controlOverlap) * DIMOS_AR_DESIGN.depth.controlThicknessScale;
    this.cancelBacking = buttonSurfaceBacking(CANCEL_DIAMETER_M, CANCEL_DIAMETER_M, CANCEL_DIAMETER_M / 2, cancelThickness);
    tintButtonBacking(this.cancelBacking, this.cancelObject.material.uniforms.uTint.value);
    this.cancelObject.add(this.cancelBacking);
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.0065), this.glyphMaterial);
      bar.rotation.z = angle;
      bar.position.z = 0.002;
      bar.raycast = () => {};
      this.glyph.push(bar);
    }
    this.cancelLabel = new Text();
    this.cancelLabel.text = "Cancel";
    this.cancelLabel.font = UI_FONT_SEMIBOLD;
    this.cancelLabel.fontSize = 0.026;
    this.cancelLabel.anchorX = "center";
    this.cancelLabel.anchorY = "middle";
    this.cancelLabel.color = 0xffffff;
    this.cancelLabel.position.set(0, -CANCEL_DIAMETER_M / 2 - 0.028, 0.002);
    this.cancelLabel.raycast = () => {};
    syncText(this.cancelLabel);
    this.cancelRoot.name = "Navigation cancel button";
    this.cancelRoot.position.set(0, 0.38, 0);
    this.cancelRoot.add(this.cancelObject, ...this.glyph, this.cancelLabel);
    this.cancelRoot.visible = false;

    this.connector.name = "Navigation cancel connector";
    this.draftCircleRenderer.object.name = "Navigation draft circle";
    this.connectorRenderer.setSegments([[0, 0.02, 0], [0, 0.275, 0]]);
    this.connectorRenderer.setStyle(0.00275, 0.6);
    this.outcomeRing.name = "Navigation outcome ring";
    this.outcomeRing.rotation.x = -Math.PI / 2;
    this.outcomeRing.position.y = 0.016;
    this.outcomeRing.raycast = () => {};
    for (let i = 0; i < 2; i++) {
      const stroke = new THREE.Mesh(new THREE.PlaneGeometry(1, NAVIGATION_OUTCOME_STYLE.glyphWidthM), markerMaterial());
      stroke.name = `Navigation outcome stroke ${i}`;
      stroke.rotation.x = -Math.PI / 2;
      stroke.raycast = () => {};
      this.outcomeStrokes.push(stroke);
    }
    this.outcomeGlyph.name = "Navigation outcome glyph";
    this.outcomeJoin.name = "Navigation outcome stroke join";
    this.outcomeJoin.rotation.x = -Math.PI / 2;
    this.outcomeJoin.raycast = () => {};
    this.outcomeGlyph.add(...this.outcomeStrokes, this.outcomeJoin);
    this.visuals.add(this.arrow, this.ring, this.outcomeRing, this.outcomeGlyph);
    this.probe.name = "Navigation floor probe";
    this.probeCircleRenderer.object.name = "Navigation probe circle";
    this.probeCircleRenderer.setSegments(circleStrokeSegments(0.06 - WORLD_DASH_STYLE.widthM / 2), true);
    this.probeCircleRenderer.setStyle(WORLD_DASH_STYLE.widthM, FLOOR_MARKER_STYLE.selectedOpacity);
    this.probe.add(this.probeCircleRenderer.object);
    this.probeStem.setSegments([[0, 0, 0], [0, 0.165, 0]]);
    this.probeStem.setStyle(0.00275, 0.6);
    this.probe.add(this.probeStem.object);
    this.probe.traverse(node => { node.raycast = () => {}; });
    this.probe.visible = false;
    this.object.add(this.disc, this.visuals, this.cancelRoot, this.connector, this.draftCircleRenderer.object);
    this.object.visible = false;
    // Proximity uses the circular hit surface, not the decorative arrow/ring bounding boxes.
    this.arrow.userData.proximityTarget = this.ring.userData.proximityTarget = false;
    for (const mesh of [this.disc, this.arrow, this.ring, this.cancelObject]) {
      mesh.userData.rayPriority = 10;
      registerRayTarget(mesh);
    }
    this.applyStyle(0);
  }

  setPose(position: Vec3, orientation: Quat): void {
    this.object.position.set(position[0], position[1], position[2]);
    this.object.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
  }

  circleBounds(): { center: Vec3; radius: number } {
    const center = this.ring.getWorldPosition(new THREE.Vector3()).toArray() as Vec3;
    return { center, radius: this.radiusM * this.ring.getWorldScale(new THREE.Vector3()).x };
  }

  pose(): { position: Vec3; orientation: Quat } {
    return {
      position: [this.object.position.x, this.object.position.y, this.object.position.z],
      orientation: [
        this.object.quaternion.x,
        this.object.quaternion.y,
        this.object.quaternion.z,
        this.object.quaternion.w,
      ],
    };
  }

  show(): void {
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
    this.setCancelVisible(false);
  }

  setGoalActive(_active: boolean): void { /* Goal existence is independent of following state. */ }
  setInteraction(dragging: boolean, following: boolean): void { this.dragging = dragging; this.following = following; }
  setHovered(hovered: boolean): void { this.hovered = hovered; }
  setSelected(selected: boolean): void { this.selected = selected; }
  setAiming(aiming: boolean): void {
    this.aiming = aiming;
    for (const mesh of [this.disc, this.arrow, this.ring]) mesh.userData.rayDisabled = aiming;
  }

  setProbe(position: Vec3 | null): void {
    this.probe.visible = position !== null;
    if (position) this.probe.position.fromArray(position);
  }

  circleOpacity(): number { return this.opacity; }
  setSharedOpacity(opacity: number): void { this.opacity = opacity; this.probeCircleRenderer.setStyle(WORLD_DASH_STYLE.widthM, opacity); this.setMarkerStyle(MARKER_COLOR, opacity); }

  tick(deltaS: number): void {
    deltaS = Math.max(0, deltaS);
    this.applyStyle(deltaS);
    if (this.cancelRequested) this.cancelProgress = Math.min(1, this.cancelProgress + deltaS / NAVIGATION_CANCEL_STYLE.revealS);
    this.applyCancelReveal();
  }

  private applyStyle(deltaS: number): void {
    const alpha = 1 - Math.exp(-32 * deltaS);
    const moving = this.following && !this.dragging && !this.aiming && !this.flash;
    this.motion += ((moving ? 1 : 0) - this.motion) * alpha;
    this.pulseTime = (this.pulseTime + deltaS) % 1.2;
    const pulse = (1 - Math.cos(this.pulseTime / 1.2 * Math.PI * 2)) / 2;
    const opacity = this.flash ? 1 : this.dragging ? FLOOR_MARKER_STYLE.dragOpacity :
      this.following ? 1 : this.selected || this.hovered ? FLOOR_MARKER_STYLE.selectedOpacity : IDLE_OPACITY;
    this.opacity += (opacity - this.opacity) * alpha;
    const scale = this.radiusM < GOAL_RADIUS_M ? 1 : (this.selected ? 1.15 : 1) * (this.hovered ? 1.04 : 1);
    this.visualScale += (scale - this.visualScale) * alpha;
    this.visuals.scale.setScalar(this.visualScale);
    const arrowScale = 1.3 * this.radiusM / GOAL_RADIUS_M;
    this.arrow.scale.set(arrowScale * (this.aiming ? NAVIGATION_PREVIEW_ARROW_STYLE.widthScale : 1), arrowScale, arrowScale);
    this.disc.scale.setScalar(this.radiusM < GOAL_RADIUS_M ? 1 : this.selected ? 1.15 : 1);
    this.ring.scale.setScalar(1 + 0.04 * pulse * this.motion);
    this.arrow.position.z = -0.012 * pulse * this.motion;
    // Keep the ring stroke physical even when selection/aim scales its radius.
    this.probeCircleRenderer.setStyle(WORLD_DASH_STYLE.widthM, this.opacity);
    const radius = this.radiusM;
    const strokeScale = this.visualScale * this.ring.scale.x;
    const positions = this.ring.geometry.getAttribute("position");
    for (let i = 0; i < 129; i++) {
      const angle = i / 128 * Math.PI * 2;
      positions.setXYZ(i, Math.cos(angle) * (radius - FLOOR_MARKER_STYLE.strokeM / strokeScale), Math.sin(angle) * (radius - FLOOR_MARKER_STYLE.strokeM / strokeScale), 0);
    }
    positions.needsUpdate = true;
    // Keep dash length/gap in world metres instead of inheriting the marker's selection scale.
    if (this.aiming) {
      this.draftCircleRenderer.object.position.y = 0.015 * this.visualScale;
      this.draftCircleRenderer.setSegments(circleStrokeSegments(radius * strokeScale - WORLD_DASH_STYLE.widthM / 2), true);
    }
    this.setMarkerStyle(MARKER_COLOR, this.opacity);
    this.applyFeedback();
  }

  setCancelVisible(visible: boolean, confirmationId = 0): void {
    const requested = visible && this.object.visible && !this.aiming && !this.flash;
    if (requested !== this.cancelRequested || confirmationId !== this.cancelConfirmationId) this.cancelProgress = 0;
    this.cancelConfirmationId = confirmationId;
    this.cancelRequested = requested;
    this.applyCancelReveal();
  }

  private applyCancelReveal(): void {
    const circleY = this.ring.position.y * this.visualScale;
    const reveal = navigationCancelReveal(this.cancelProgress, circleY);
    this.cancelRoot.visible = this.cancelRequested;
    this.cancelObject.userData.rayDisabled = !this.cancelRequested || this.cancelProgress < 1;
    this.connector.visible = this.cancelRequested && reveal.scale > 0;
    this.cancelRoot.position.y = reveal.heightM;
    const scale = reveal.scale * (1 + (this.cancelProgress === 1 ? this.cancelObject.hover() : 0) * 0.08);
    this.cancelRoot.scale.setScalar(scale);
    this.connectorRenderer.setSegments([[0, circleY, 0], [0, Math.max(circleY,
      reveal.heightM - NAVIGATION_CANCEL_STYLE.connectorClearanceM * scale), 0]]);
  }

  cancelVisible(): boolean {
    return this.cancelRoot.visible;
  }

  /** Yaw-only billboard toward the viewer, independent of the goal heading. */
  update(eye: THREE.Vector3, cancelHovered: boolean): void {
    this.object.updateWorldMatrix(true, false);
    const center = this.cancelRoot.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(eye.x - center.x, eye.z - center.z));
    this.cancelRoot.quaternion.copy(this.object.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(yaw));
    if (this.flash) {
      // Floor glyphs face the viewer in yaw without changing the goal, ring, or heading arrow.
      const glyphPosition = this.outcomeGlyph.getWorldPosition(new THREE.Vector3());
      const dx = eye.x - glyphPosition.x, dz = eye.z - glyphPosition.z;
      if (dx * dx + dz * dz > 1e-8) {
        const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
        this.outcomeGlyph.quaternion.copy(this.visuals.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(facing));
      }
    }
    this.cancelObject.setHover(cancelHovered && this.cancelRequested && this.cancelProgress === 1 ? 1 : 0);
    this.cancelObject.step();
    tintButtonBacking(this.cancelBacking, this.cancelObject.material.uniforms.uTint.value, this.cancelObject.hover());
    this.applyCancelReveal();
  }

  setFlash(flash: NavFlash | null, progress = 0): void {
    this.flash = flash;
    this.feedbackProgress = progress;
    this.applyFeedback();
  }

  private applyFeedback(): void {
    this.ring.visible = !this.aiming || this.flash !== null;
    this.draftCircleRenderer.object.visible = this.aiming && this.flash === null;
    this.outcomeRing.visible = this.flash !== null;
    this.arrow.visible = this.flash === null;
    this.outcomeStrokes.forEach(stroke => { stroke.visible = this.flash !== null; });
    this.outcomeJoin.visible = false;
    if (!this.flash) return;
    const color = FLASH_COLORS[this.flash];
    const elapsed = this.feedbackProgress * NAV_FEEDBACK_ANIMATION_S;
    this.outcomeRing.material.color.setHex(color);
    this.outcomeRing.material.opacity = 1;
    this.outcomeRing.geometry.setDrawRange(0, Math.floor(Math.min(1, elapsed / NAV_FEEDBACK_TIMING.traceS) * 128) * 6);
    const points: readonly (readonly number[])[] = this.flash === "succeeded" ? NAVIGATION_OUTCOME_STYLE.check : NAVIGATION_OUTCOME_STYLE.cross;
    const segments = this.flash === "succeeded" ? [[...points[0], ...points[1]], [...points[1], ...points[2]]] :
      [[...points[0], ...points[1]], [...points[2], ...points[3]]];
    const progresses = [0, 1].map(i => THREE.MathUtils.clamp((elapsed - NAV_FEEDBACK_TIMING.traceS) / (NAV_FEEDBACK_TIMING.glyphS / 2) - i, 0, 1));
    const joint = strokeJoints2D(segments, progresses)[0];
    this.outcomeJoin.visible = !!joint;
    if (joint) {
      this.outcomeJoin.position.set(joint[0], 0.024, -joint[1]);
      this.outcomeJoin.material.color.setHex(color);
    }
    this.outcomeStrokes.forEach((stroke, i) => {
      const [x1, y1, x2, y2] = segments[i];
      const progress = progresses[i];
      const eased = progress * progress * (3 - 2 * progress);
      stroke.scale.x = Math.hypot(x2 - x1, y2 - y1) * eased;
      stroke.rotation.z = Math.atan2(y2 - y1, x2 - x1);
      stroke.position.set(x1 + (x2 - x1) * eased / 2, 0.024, -(y1 + (y2 - y1) * eased / 2));
      stroke.material.color.setHex(color);
      stroke.material.opacity = 1;
    });
  }

  dispose(): void {
    this.object.removeFromParent();
    this.probe.removeFromParent();
    this.probeStem.dispose();
    this.probeCircleRenderer.dispose();
    this.probe.traverse(node => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
      if (node instanceof THREE.InstancedMesh) node.dispose();
    });
    for (const mesh of [this.outcomeRing, this.outcomeJoin, ...this.outcomeStrokes]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.connectorRenderer.dispose();
    this.draftCircleRenderer.dispose();
    this.disc.geometry.dispose();
    this.arrow.geometry.dispose();
    this.ring.geometry.dispose();
    this.cancelBacking.geometry.dispose();
    this.cancelBacking.material.dispose();
    this.cancelObject.dispose();
    for (const bar of this.glyph) bar.geometry.dispose();
    disposeTextResources(this.cancelLabel);
    this.discMaterial.dispose();
    this.arrowMaterial.dispose();
    this.ringMaterial.dispose();
    this.glyphMaterial.dispose();
  }

  private setMarkerStyle(color: number, opacity: number): void {
    this.draftCircleRenderer.setStyle(WORLD_DASH_STYLE.widthM, opacity);
    for (const material of [this.arrowMaterial, this.ringMaterial]) {
      material.color.setHex(color);
      material.opacity = opacity;
    }
    if (this.aiming) this.arrowMaterial.opacity *= NAVIGATION_PREVIEW_ARROW_STYLE.opacityScale;
  }
}

function markerMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false });
}
