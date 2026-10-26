import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { odomToClientTrackingYawPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { NavGoal } from "../../DimOSARClient/websocket/protocolTypes";
import { clientTrackingToSpecsYawPose } from "../utilities/SpecsCoordinates";
import { AdaptiveStrokeRenderer, WorldMeshRenderer } from "../presentation/WorldMeshRenderer";
import { ROUTE_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { anchorPathStart, clipPathToCircles, routeRibbon, rangePathY as sharedRangePathY, filletPathCorners as sharedFilletPathCorners } from "./RoutePathGeometry";

export type RouteCircle = { center: [number, number, number]; radius: number };

export class NavGoalPresenter {
  private readonly dots: AdaptiveStrokeRenderer;
  private readonly ribbon: WorldMeshRenderer;
  private lastPath: import("../../DimOSARClient/websocket/protocolTypes").YawPose[] | null = null;
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
    path?: import("../../DimOSARClient/websocket/protocolTypes").YawPose[] | null;
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
    let points = path.map(p => {
      const s = clientTrackingToSpecsYawPose(odomToClientTrackingYawPose(p, input.origin!));
      return [s[0] / 100, s[1] / 100, s[2] / 100] as [number, number, number];
    });
    const circle = (c?: RouteCircle) => c && ({ center: c.center.map(v => v / 100) as [number, number, number], radius: c.radius / 100 + (solid ? ROUTE_STYLE.ribbonWidthM / 2 : 0) });
    const start = circle(input.startCircle), end = circle(input.endCircle);
    if (start) points = anchorPathStart(points, start.center);
    if (end) points[points.length - 1] = [...end.center];
    points = sharedRangePathY(clipPathToCircles(sharedFilletPathCorners(points), start, end),
      start?.center[1] ?? (input.floorY == null ? null : input.floorY / 100),
      end?.center[1] ?? (input.goalY == null ? null : input.goalY / 100));
    if (points.length < 2) { this.lastPath = null; this.hide(); return; }
    if (solid) {
      const geometry = routeRibbon(points, ROUTE_STYLE.ribbonWidthM);
      this.ribbon.triangles(geometry.positions.map(v => v * 100), geometry.indices, [1, 1, 1, ROUTE_STYLE.confirmedOpacity]);
      this.dots.hide();
    } else {
      this.ribbon.hide();
      const cm = points.map(p => p.map(v => v * 100) as [number, number, number]);
      this.dots.setViewportHeight(input.viewportHeight ?? 1024);
      this.dots.segments(cm.slice(0, -1).flatMap((p, i) => [p, cm[i + 1]]), ROUTE_STYLE.dotWidthM * 100,
        input.preview ? ROUTE_STYLE.previewOpacity : ROUTE_STYLE.confirmedOpacity,
        ROUTE_STYLE.dashM * 100, ROUTE_STYLE.gapM * 100, true);
    }
  }

  hide(): void { this.dots.hide(); this.ribbon.hide(); }
  destroy(): void { this.dots.destroy(); this.ribbon.destroy(); }
}
