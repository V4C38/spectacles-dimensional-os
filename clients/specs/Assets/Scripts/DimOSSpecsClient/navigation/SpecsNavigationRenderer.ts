import type { ReadonlyFacts } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { ARM_VISUAL_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationPresentation";
import { NAV_FEEDBACK_ANIMATION_S, NAV_FEEDBACK_TIMING, type NavFlash } from "DimOSARClient.lspkg/Scripts/DimOSARClient/navigation/NavigationInteraction";
import { FLOOR_MARKER_STYLE, NAVIGATION_COLORS, NAVIGATION_OUTCOME_STYLE, NAVIGATION_PREVIEW_ARROW_STYLE, WORLD_DASH_STYLE, circleStrokeSegments, navigationCancelReveal, ROUTE_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, circleMesh, strokeMesh2D, type WorldColor } from "../presentation/WorldMeshRenderer";
import { type ClientTrackingOrigin as MutableClientTrackingOrigin, odomToClientTrackingYawPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

import { prepareRoutePath, routeRibbon } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/RoutePathGeometry";

import type { NavGoal } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { clientTrackingToSpecsYawPose } from "../utilities/SpecsCoordinates";

type ClientTrackingOrigin = ReadonlyFacts<MutableClientTrackingOrigin>;

export interface NavigationMarkerStyle {
  selected: boolean; blocked?: boolean; hovered?: boolean; dragging: boolean; following: boolean;
  aiming: boolean; cancelVisible?: boolean; cancelProgress?: number; flash: NavFlash | null; feedbackProgress: number; opacity?: number;
}

/** Native world geometry driven entirely by shared navigation facts. */
export class NavigationMarkerRenderer {
  readonly root: SceneObject;
  private readonly circle: WorldMeshRenderer;
  private readonly draftCircle: AdaptiveStrokeRenderer;
  private readonly arrow: WorldMeshRenderer;
  private readonly outcomeRing: WorldMeshRenderer;
  private readonly glyph: WorldMeshRenderer;
  private readonly stem: AdaptiveStrokeRenderer;
  private opacity = FLOOR_MARKER_STYLE.idleOpacity as number;
  private scale = 1;
  private time = 0;
  private motion = 0;
  private radiusCm: number;
  private renderedRadius = 0;

  constructor(parent: SceneObject, radiusCm = FLOOR_MARKER_STYLE.radiusM * 100,
    private readonly probe = false) {
    this.radiusCm = radiusCm;
    this.root = global.scene.createSceneObject("NavigationWorldVisuals"); this.root.setParent(parent);
    this.circle = new WorldMeshRenderer(this.root, "NavigationCircle");
    this.draftCircle = new AdaptiveStrokeRenderer(this.root, "NavigationDraftCircle");
    this.arrow = new WorldMeshRenderer(this.root, "NavigationHeading");
    this.outcomeRing = new WorldMeshRenderer(this.root, "NavigationOutcomeRing");
    this.glyph = new WorldMeshRenderer(this.root, "NavigationOutcomeGlyph");
    this.stem = new AdaptiveStrokeRenderer(this.root, "NavigationStem");
    this.circle.object.getTransform().setLocalPosition(new vec3(0, 1.5, 0));
    this.draftCircle.object.getTransform().setLocalPosition(new vec3(0, 1.5, 0));
    this.arrow.object.getTransform().setLocalPosition(new vec3(0, 2.3, 0));
    this.glyph.object.getTransform().setLocalPosition(new vec3(0, 2.4, 0));
  }

  orientGlyph(eye: vec3): void {
    const p = this.glyph.object.getTransform().getWorldPosition();
    const dx = eye.x - p.x, dz = eye.z - p.z;
    if (dx * dx + dz * dz > 0.001) this.glyph.object.getTransform().setWorldRotation(quat.angleAxis(Math.atan2(dx, dz), vec3.up()));
  }
  setRadius(radiusCm: number): void { this.radiusCm = radiusCm; }
  circleOpacity(): number { return this.opacity; }
  circleHeightCm(): number { return 1.5 * this.scale; }
  circleBounds() {
    const p = this.circle.object.getTransform().getWorldPosition();
    const scale = this.root.getTransform().getWorldScale();
    return { center: [p.x, p.y, p.z] as [number, number, number], radius: this.renderedRadius * Math.max(Math.abs(scale.x), Math.abs(scale.z)) };
  }

  apply(style: NavigationMarkerStyle, dt: number, viewportHeight: number): void {
    const alpha = 1 - Math.exp(-32 * Math.max(0, dt));
    this.time = (this.time + Math.max(0, dt)) % 1.2;
    this.motion += ((style.following && !style.dragging && !style.aiming && !style.flash ? 1 : 0) - this.motion) * alpha;
    const pulse = (1 - Math.cos(this.time / 1.2 * Math.PI * 2)) / 2;
    const targetOpacity = style.flash ? 1 : style.dragging ? FLOOR_MARKER_STYLE.dragOpacity :
      style.following ? 1 : style.selected || style.hovered ? FLOOR_MARKER_STYLE.selectedOpacity : FLOOR_MARKER_STYLE.idleOpacity;
    this.opacity = style.opacity ?? this.opacity + (targetOpacity - this.opacity) * alpha;
    const targetScale = this.radiusCm < 20 ? 1 : (style.selected ? 1.15 : 1) * (style.hovered ? 1.04 : 1);
    this.scale += (targetScale - this.scale) * alpha;
    const radius = this.radiusCm * this.scale * (1 + 0.04 * pulse * this.motion);
    this.renderedRadius = radius;
    const color: WorldColor = style.flash ? [...NAVIGATION_COLORS[style.flash], 1] : style.blocked ? ownershipColor(this.opacity) : [1, 1, 1, this.opacity];
    this.circle.object.getTransform().setLocalPosition(new vec3(0, this.circleHeightCm(), 0));
    this.draftCircle.object.getTransform().setLocalPosition(new vec3(0, this.circleHeightCm(), 0));
    this.arrow.object.getTransform().setLocalPosition(new vec3(0, 2.3 * this.scale, 0));
    this.glyph.object.getTransform().setLocalPosition(new vec3(0, 2.4 * this.scale, 0));
    const elapsed = style.feedbackProgress * NAV_FEEDBACK_ANIMATION_S;
    if (style.aiming && !style.flash) {
      this.circle.hide();
      this.draftCircle.setViewportHeight(viewportHeight);
      this.draftCircle.segments(circleStrokeSegments(radius - WORLD_DASH_STYLE.widthM * 50),
        WORLD_DASH_STYLE.widthM * 100, this.opacity, WORLD_DASH_STYLE.dashM * 100,
        WORLD_DASH_STYLE.gapM * 100, true, [color[0], color[1], color[2]]);
    } else {
      this.draftCircle.hide();
      const ring = circleMesh(radius, FLOOR_MARKER_STYLE.strokeM * 100);
      // Retain the full white floor circle beneath the colored tracing ring.
      this.circle.triangles(ring.positions, ring.indices, style.blocked ? color : [1, 1, 1, this.opacity]);
    }
    if (style.flash) {
      this.arrow.hide(); this.stem.hide();
      this.outcomeRing.object.getTransform().setLocalPosition(new vec3(0, 1.6 * this.scale, 0));
      const trace = circleMesh(this.radiusCm * this.scale, FLOOR_MARKER_STYLE.strokeM * 100 * this.scale,
        Math.min(1, elapsed / NAV_FEEDBACK_TIMING.traceS), NAVIGATION_OUTCOME_STYLE.segments, 0);
      this.outcomeRing.triangles(trace.positions, trace.indices, color);
      const points: readonly (readonly number[])[] = style.flash === "succeeded" ? NAVIGATION_OUTCOME_STYLE.check : NAVIGATION_OUTCOME_STYLE.cross;
      const segments = style.flash === "succeeded" ? [[...points[0], ...points[1]], [...points[1], ...points[2]]] :
        [[...points[0], ...points[1]], [...points[2], ...points[3]]];
      const glyph = strokeMesh2D(segments.map(row => row.map(v => v * 100)),
        [0, 1].map(i => (elapsed - NAV_FEEDBACK_TIMING.traceS) / (NAV_FEEDBACK_TIMING.glyphS / 2) - i),
        NAVIGATION_OUTCOME_STYLE.glyphWidthM * 100, "xz", this.scale);
      this.glyph.triangles(glyph.positions, glyph.indices, color); return;
    }
    this.outcomeRing.hide();
    this.glyph.hide();
    if (this.probe) this.arrow.hide();
    else {
      const points = [[0, 10], [-5, 2], [-1.4, 2], [-1.4, -8.5], [1.4, -8.5], [1.4, 2], [5, 2]];
      const factor = 1.3 * this.radiusCm / (FLOOR_MARKER_STYLE.radiusM * 100) * this.scale;
      // The authored Specs marker's heading is local +X.
      const width = style.aiming ? NAVIGATION_PREVIEW_ARROW_STYLE.widthScale : 1;
      const opacity = color[3] * (style.aiming ? NAVIGATION_PREVIEW_ARROW_STYLE.opacityScale : 1);
      this.arrow.triangles(points.flatMap(([x, y]) => [y * factor + 1.2 * pulse * this.motion * this.scale, 0, x * factor * width]),
        [0, 1, 2, 0, 2, 5, 0, 5, 6, 2, 3, 4, 2, 4, 5], [color[0], color[1], color[2], opacity]);
    }
    this.stem.setViewportHeight(viewportHeight);
    if (this.probe) this.stem.segments([[0, 0, 0], [0, 16.5, 0]], 0.275, this.opacity);
    else if (style.cancelVisible && (style.cancelProgress ?? 1) > 0) {
      const reveal = navigationCancelReveal(style.cancelProgress ?? 1, this.circleHeightCm() / 100);
      this.stem.segments([[0, this.circleHeightCm(), 0], [0, reveal.connectorTopM * 100, 0]], 0.275, 0.6);
    }
    else this.stem.hide();
  }

  hide(): void { this.root.enabled = false; }
  show(): void { this.root.enabled = true; }
  destroy(): void { this.root.destroy(); }
}

function ownershipColor(opacity: number): WorldColor {
  const color = ARM_VISUAL_STYLE.warningColor;
  return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, opacity];
}

export type RouteCircle = { center: [number, number, number]; radius: number };

export class NavigationRouteRenderer {
  private readonly dots: AdaptiveStrokeRenderer;
  private readonly ribbon: WorldMeshRenderer;
  private lastPath: readonly Readonly<import("DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts").YawPose>[] | null = null;
  private lastOrigin: ClientTrackingOrigin | null = null;
  private lastParameters: number[] = [];
  private lastSolid = false;

  constructor(parent: SceneObject) {
    this.dots = new AdaptiveStrokeRenderer(parent, "NavigationRouteDots");
    this.ribbon = new WorldMeshRenderer(parent, "NavigationRouteRibbon");
    for (const renderer of [this.dots, this.ribbon]) {
      renderer.object.getTransform().setWorldPosition(vec3.zero());
      renderer.object.getTransform().setWorldRotation(quat.quatIdentity());
      renderer.object.getTransform().setWorldScale(vec3.one());
    }
  }

  apply(input: {
    nav_goal?: NavGoal | null;
    path?: readonly Readonly<import("DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts").YawPose>[] | null;
    origin: ClientTrackingOrigin | null;
    pathVisible?: boolean;
    floorY?: number | null;
    goalY?: number | null;
    preview?: boolean;
    executing?: boolean;
    startCircle?: RouteCircle;
    endCircle?: RouteCircle;
    viewportHeight?: number;
  }): void {
    const path = input.path ?? input.nav_goal?.path_poses;
    if (input.pathVisible === false || !input.origin || !path || path.length < 2) { this.hide(); return; }
    const solid = input.executing === true && !input.preview;
    const parameters = [Number(solid), Number(input.preview), input.floorY ?? NaN, input.goalY ?? NaN,
      ...(input.startCircle?.center ?? []), input.startCircle?.radius ?? NaN,
      ...(input.endCircle?.center ?? []), input.endCircle?.radius ?? NaN];
    this.dots.setViewportHeight(input.viewportHeight ?? 1024);
    if (path === this.lastPath && input.origin === this.lastOrigin && parameters.length === this.lastParameters.length &&
      parameters.every((value, i) => Object.is(value, this.lastParameters[i]))) {
      this.ribbon.object.enabled = this.lastSolid; this.dots.object.enabled = !this.lastSolid;
      return;
    }
    this.lastPath = path; this.lastOrigin = input.origin; this.lastParameters = parameters; this.lastSolid = solid;
    const converted = path.map(p => {
      const s = clientTrackingToSpecsYawPose(odomToClientTrackingYawPose(p, input.origin!));
      return [s[0] / 100, s[1] / 100, s[2] / 100] as [number, number, number];
    });
    const circle = (c?: RouteCircle) => c && ({ center: c.center.map(v => v / 100) as [number, number, number], radius: c.radius / 100 });
    const start = circle(input.startCircle), end = circle(input.endCircle);
    const { points } = prepareRoutePath(converted, {
      startCircle: start,
      endCircle: end,
      floorY: input.floorY == null ? null : input.floorY / 100,
      goalY: input.goalY == null ? null : input.goalY / 100,
      solid,
      widthM: ROUTE_STYLE.ribbonWidthM,
    });
    if (points.length < 2) { this.lastPath = null; this.hide(); return; }
    if (solid) {
      const geometry = routeRibbon(points, ROUTE_STYLE.ribbonWidthM);
      this.ribbon.triangles(geometry.positions.map(v => v * 100), geometry.indices, [1, 1, 1, ROUTE_STYLE.confirmedOpacity]);
      this.dots.hide();
    } else {
      this.ribbon.hide();
      const cm = points.map(p => p.map(v => v * 100) as [number, number, number]);
      this.dots.setViewportHeight(input.viewportHeight ?? 1024);
      this.dots.segments(cm.slice(0, -1).flatMap((p, i) => [p, cm[i + 1]]), ROUTE_STYLE.strokeM * 100,
        input.preview ? ROUTE_STYLE.previewOpacity : ROUTE_STYLE.confirmedOpacity,
        ROUTE_STYLE.dashM * 100, ROUTE_STYLE.gapM * 100, true);
    }
  }

  hide(): void { this.dots.hide(); this.ribbon.hide(); }
  destroy(): void { this.dots.destroy(); this.ribbon.destroy(); }
}
