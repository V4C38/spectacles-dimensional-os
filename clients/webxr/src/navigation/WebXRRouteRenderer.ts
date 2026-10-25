import * as THREE from "three";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import type { InterleavedBufferAttribute } from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingYawPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import type { Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import { clientTrackingToWebxrPoint } from "../utilities/WebXRCoordinates";
import { anchorPathStart, clipPathToCircles, filletPathCorners, rangePathY, routeRibbon, type RouteCircle } from "./RoutePathGeometry";

export type RouteStyle = { preview?: boolean; executing?: boolean; startCircle?: RouteCircle; endCircle?: RouteCircle };

export class WebXRRouteRenderer {
  readonly object: Line2;
  private readonly dashed = new AdaptiveDashedLineRenderer(0.01, 0.01, 0.018);
  private readonly solid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.85, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  private geometry: LineGeometry;
  private readonly material: LineMaterial;

  constructor() {
    this.geometry = new LineGeometry();
    this.material = new LineMaterial({ color: 0xffffff, linewidth: 0.01, worldUnits: true, dashed: true, dashSize: 0.01, gapSize: 0.018, opacity: 0.85, transparent: true, depthWrite: false, toneMapped: false });
    // Round each short dash using world-space distance, retaining Line2's single draw call.
    this.material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("float norm = len / linewidth;", `float norm = len / linewidth;
        #ifdef USE_DASH
          float along = mod(vLineDistance + dashOffset, dashSize + gapSize) - dashSize * 0.5;
          if (len * len + along * along > linewidth * linewidth * 0.25) discard;
        #endif`);
    };
    this.material.customProgramCacheKey = () => "dimos-dotted-route-v1";
    this.object = new Line2(this.geometry, this.material);
    this.object.name = "WebXRRouteRenderer";
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
    this.material.linewidth = solid ? 0.008 : 0.01;
    this.material.dashed = !solid;
    this.material.visible = false;
    this.dashed.object.visible = !solid;
    this.solid.visible = solid;
    this.material.opacity = style.preview ? 0.6 : 0.85;
    this.dashed.setStyle(0.01, this.material.opacity);
    if (style.startCircle) converted = anchorPathStart(converted, style.startCircle.center);
    if (style.endCircle) converted[converted.length - 1] = [...style.endCircle.center];
    const clearance = (circle?: RouteCircle): RouteCircle | undefined => circle && ({ ...circle, radius: circle.radius + (solid ? this.material.linewidth / 2 : 0) });
    const clipped = clipPathToCircles(filletPathCorners(converted), clearance(style.startCircle), clearance(style.endCircle));
    if (clipped.length < 2) { this.hide(); return; }
    const processed = rangePathY(clipped, style.startCircle?.center[1] ?? floorY, style.endCircle?.center[1] ?? goalY);
    if (solid) {
      const ribbon = routeRibbon(processed, this.material.linewidth);
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
    const count = processed.length - 1;
    if (this.geometry.getAttribute("instanceStart")?.count !== count) {
      // WebGL caches the first instance count. A changed segment count needs
      // fresh geometry so a growing route is not capped at its first batch.
      this.geometry.dispose();
      this.geometry = new LineGeometry().setPositions(processed.flat());
      this.object.geometry = this.geometry;
    } else {
      const start = this.geometry.getAttribute("instanceStart") as InterleavedBufferAttribute;
      const end = this.geometry.getAttribute("instanceEnd") as InterleavedBufferAttribute;
      processed.slice(0, -1).forEach((point, index) => {
        start.setXYZ(index, ...point);
        end.setXYZ(index, ...processed[index + 1]);
      });
      start.data.needsUpdate = true;
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
    }
    this.object.computeLineDistances();
    const distances = this.geometry.getAttribute("instanceDistanceEnd");
    const total = distances.getX(distances.count - 1);
    if (total <= 1e-6) { this.hide(); return; }
    // Finish a complete dot at both circle boundaries rather than ending in a gap.
    const period = this.material.dashSize + this.material.gapSize;
    this.material.dashScale = (Math.max(0, Math.round((total - this.material.dashSize) / period)) * period + this.material.dashSize) / total;
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.dashed.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.solid.geometry.dispose();
    this.solid.material.dispose();
  }
}
