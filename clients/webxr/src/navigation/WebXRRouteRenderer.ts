import * as THREE from "three";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import { ROUTE_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingYawPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import type { Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import { clientTrackingToWebxrPoint } from "../utilities/WebXRCoordinates";
import { anchorPathStart, clipPathToCircles, filletPathCorners, rangePathY, routeRibbon, type RouteCircle } from "@dimos-ar-client/presentation/RoutePathGeometry";

export type RouteStyle = { preview?: boolean; executing?: boolean; startCircle?: RouteCircle; endCircle?: RouteCircle };

export class WebXRRouteRenderer {
  readonly object = new THREE.Group();
  private readonly dashed = new AdaptiveDashedLineRenderer(ROUTE_STYLE.strokeM, ROUTE_STYLE.dashM, ROUTE_STYLE.gapM);
  private readonly solid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.85, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));

  constructor() {
    this.object.name = "WebXRRouteRenderer";
    for (const root of [this.object, this.solid, this.dashed.object]) root.traverse(part => { part.userData.environmentDepth = true; });
    this.solid.name = "Executing route ribbon";
    this.solid.raycast = () => {};
    this.object.add(this.solid, this.dashed.object);
    this.object.raycast = () => {};
    this.object.visible = false;
  }

  apply(
    path: YawPose[] | null,
    origin: ClientTrackingOrigin | null,
    visible: boolean,
    floorY: number | null,
    goalY: number | null,
    style: RouteStyle = {},
  ): void {
    if (!visible || !path || path.length < 2 || !origin) {
      this.object.visible = false;
      return;
    }
    let converted: Vec3[] = path.map((pose) => {
      const tracking = odomToClientTrackingYawPose(pose, origin);
      return clientTrackingToWebxrPoint([tracking[0], tracking[1], tracking[2]]);
    });
    const solid = style.executing === true && !style.preview;
    const width = solid ? ROUTE_STYLE.ribbonWidthM : ROUTE_STYLE.strokeM;
    this.dashed.object.visible = !solid;
    this.solid.visible = solid;
    this.dashed.setStyle(ROUTE_STYLE.strokeM, style.preview ? ROUTE_STYLE.previewOpacity : ROUTE_STYLE.confirmedOpacity);
    if (style.startCircle) converted = anchorPathStart(converted, style.startCircle.center);
    if (style.endCircle) converted[converted.length - 1] = [...style.endCircle.center];
    const clearance = (circle?: RouteCircle): RouteCircle | undefined => circle && ({ ...circle, radius: circle.radius + (solid ? width / 2 : 0) });
    const clipped = clipPathToCircles(filletPathCorners(converted), clearance(style.startCircle), clearance(style.endCircle));
    if (clipped.length < 2) { this.hide(); return; }
    const processed = rangePathY(clipped, style.startCircle?.center[1] ?? floorY, style.endCircle?.center[1] ?? goalY);
    if (solid) {
      const ribbon = routeRibbon(processed, width);
      const positions = this.solid.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (positions?.array.length === ribbon.positions.length) {
        positions.copyArray(ribbon.positions); positions.needsUpdate = true;
      } else {
        this.solid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(ribbon.positions, 3));
        this.solid.geometry.setIndex(ribbon.indices);
      }
      this.solid.geometry.computeBoundingSphere();
    }
    if (!solid) this.dashed.setSegments(processed.slice(0, -1).flatMap((p, i) => [p, processed[i + 1]]), true);
    const total = processed.reduce((length, point, i) => length + (i ? Math.hypot(...point.map((value, axis) => value - processed[i - 1][axis])) : 0), 0);
    if (total <= 1e-6) { this.hide(); return; }
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.dashed.dispose();
    this.solid.geometry.dispose();
    this.solid.material.dispose();
  }
}
