import * as THREE from "three";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingPoint } from "@dimos-ar-client/localization/clientTrackingTransforms";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { lidarHeightColor, lidarBodyClearance } from "@dimos-ar-client/sensors/lidarColors";
import { LIDAR_PRESETS, type LidarDisplayMode } from "@dimos-ar-client/sensors/lidarSettings";
import { OBSTACLE_HALO_M } from "./WebXRLidarSettings";
import { clientTrackingToWebxrPoint } from "../utilities/WebXRCoordinates";

export const MAX_LIDAR_POINTS = 4000;
const HEIGHT_COLORS = Array.from({ length: 256 }, (_, i) => new THREE.Color().setRGB(...lidarHeightColor(i / 255), THREE.SRGBColorSpace));

function dotTexture(): THREE.DataTexture {
  const size = 32, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    bytes[i] = bytes[i + 1] = bytes[i + 2] = 255;
    bytes[i + 3] = Math.round(255 * THREE.MathUtils.clamp((1 - radius) / 0.1, 0, 1));
  }
  const texture = new THREE.DataTexture(bytes, size, size); texture.needsUpdate = true;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  return texture;
}

export class WebXRLidarRenderer {
  readonly object: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly texture = dotTexture();
  private readonly material = new THREE.PointsMaterial({ size: 0.016, map: this.texture, alphaTest: 0.001, transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, vertexColors: true, depthWrite: false, toneMapped: false });
  private readonly positions = new THREE.BufferAttribute(new Float32Array(MAX_LIDAR_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  private readonly colors = new THREE.BufferAttribute(new Float32Array(MAX_LIDAR_POINTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private lastPoints: Vec3[] | null = null;
  private lastOrigin: ClientTrackingOrigin | null = null;
  private colorKey = "";
  private lastLimit = 0;

  constructor() {
    // Custom alpha blending keeps the cloud in the early opaque queue, ahead of all UI.
    // Keep distant dots legible, with a bounded close-up footprint and no sphere geometry.
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace("#include <logdepthbuf_vertex>", "gl_PointSize = clamp(gl_PointSize, 2.5, 8.0);\n#include <logdepthbuf_vertex>");
    };
    this.material.customProgramCacheKey = () => "dimos-lidar-round-dots-v1";
    this.geometry.setAttribute("position", this.positions); this.geometry.setAttribute("color", this.colors);
    this.geometry.setDrawRange(0, 0);
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.name = "WebXRLidarRenderer";
    this.object.renderOrder = -100;
    this.object.raycast = () => {};
    // Unused preallocated vertices must not inflate or invalidate cloud culling bounds.
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  apply(points: Vec3[] | null, origin: ClientTrackingOrigin | null, mode: LidarDisplayMode, robot: Vec3 | null = null, baseHeightM = 0, orientation: Quat = [0, 0, 0, 1], bounds: Vec3 = [0.7, 0.5, 0.55], pointLimit = MAX_LIDAR_POINTS, obstacleRangeM = OBSTACLE_HALO_M): void {
    if (!points?.length || !origin || mode === "off") { this.hide(); return; }
    const count = Math.min(points.length, MAX_LIDAR_POINTS, Math.max(0, Math.floor(pointLimit)));
    const changed = this.lastPoints !== points || this.lastOrigin !== origin || this.lastLimit !== pointLimit;
    if (changed) {
      for (let i = 0; i < count; i++) {
        const source = points[Math.floor(i * points.length / count)];
        this.positions.setXYZ(i, ...clientTrackingToWebxrPoint(odomToClientTrackingPoint(source, origin)));
      }
      this.positions.needsUpdate = true;
      this.geometry.setDrawRange(0, count);
    }
    const floor = robot ? robot[2] - baseHeightM : 0;
    const key = mode === "full" ? `${mode}:${floor}` : `${mode}:${obstacleRangeM}:${robot?.join(",")}:${orientation.join(",")}:${bounds.join(",")}`;
    if (changed || key !== this.colorKey) {
      for (let i = 0; i < count; i++) {
        const source = points[Math.floor(i * points.length / count)];
        if (mode === "obstacles") {
          const t = robot ? Math.min(1, lidarBodyClearance(source, robot, orientation, bounds) / Math.max(0.001, obstacleRangeM)) : 1;
          this.colors.setXYZW(i, 1, 0, 0, 1 - t * t * (3 - 2 * t));
        } else {
          const settings = LIDAR_PRESETS.full;
          const t = THREE.MathUtils.clamp((source[2] - floor - settings.min_height_m) / (settings.max_height_m - settings.min_height_m), 0, 1);
          const color = HEIGHT_COLORS[Math.round(t * 255)];
          this.colors.setXYZW(i, color.r, color.g, color.b, 1);
        }
      }
      this.colors.needsUpdate = true;
    }
    this.lastPoints = points; this.lastLimit = pointLimit; this.lastOrigin = origin; this.colorKey = key;
    this.object.visible = true;
  }
  hide(): void { this.object.visible = false; }
  dispose(): void { this.object.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}
