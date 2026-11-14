import * as THREE from "three";
import { type ClientTrackingOrigin, odomToClientTrackingPoint } from "@dimos-ar-client/localization/ClientTracking";

import type { ReadonlyFacts, Quat, Vec3 } from "@dimos-ar-client/ClientContracts";
import { LidarFrameSampler } from "@dimos-ar-client/sensors/LidarRendering";
import { type LidarDisplayMode } from "@dimos-ar-client/sensors/LidarDisplay";

import { clientTrackingToWebxrPoint } from "../utilities/WebXRCoordinates";

export const MAX_LIDAR_POINTS = 4000;


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

/** Named physical inputs; rendering never mutates received session facts. */
export interface LidarRenderInput {
  points: readonly Readonly<Vec3>[] | null;
  origin: ReadonlyFacts<ClientTrackingOrigin> | null;
  mode: LidarDisplayMode;
  robot?: Readonly<Vec3> | null;
  baseHeightM?: number;
  orientation?: Readonly<Quat>;
  bounds?: Readonly<Vec3>;
  pointLimit?: number;
  obstacleRangeM?: number;
  odomScaleCorrectionFactor?: number;
}

export class WebXRLidarRenderer {
  readonly object: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly texture = dotTexture();
  private readonly material = new THREE.PointsMaterial({ size: 0.024, map: this.texture, alphaTest: 0.001, transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, vertexColors: true, depthWrite: false, toneMapped: false });
  private readonly positions = new THREE.BufferAttribute(new Float32Array(MAX_LIDAR_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  private readonly colors = new THREE.BufferAttribute(new Float32Array(MAX_LIDAR_POINTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private readonly sampler = new LidarFrameSampler<ReadonlyFacts<ClientTrackingOrigin>>(
    (point, origin) => clientTrackingToWebxrPoint(odomToClientTrackingPoint(point, origin)),
    { maximum: MAX_LIDAR_POINTS, minimum: 0, default: MAX_LIDAR_POINTS });
  private readonly color = new THREE.Color();

  constructor() {
    // Custom alpha blending keeps the cloud in the early opaque queue, ahead of all UI.
    // Keep distant dots legible, with a bounded close-up footprint and no sphere geometry.
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace("#include <logdepthbuf_vertex>", "gl_PointSize = clamp(gl_PointSize, 3.75, 12.0);\n#include <logdepthbuf_vertex>");
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

  apply(input: LidarRenderInput): void {
    const { points, origin, mode } = input;
    if (!points?.length || !origin || mode === "off") { this.hide(); return; }
    const frame = this.sampler.sample({ ...input, points, origin, mode });
    if (frame.positionsChanged) {
      frame.positions.forEach((point, i) => this.positions.setXYZ(i, ...point));
      this.positions.needsUpdate = true;
      this.geometry.setDrawRange(0, frame.positions.length);
    }
    if (frame.colorsChanged) {
      frame.colors.forEach(([r, g, b, alpha], i) => {
        // Three stores linear RGB; native shaders consume the shared authored sRGB palette.
        this.color.setRGB(r, g, b, THREE.SRGBColorSpace);
        this.colors.setXYZW(i, this.color.r, this.color.g, this.color.b, alpha);
      });
      this.colors.needsUpdate = true;
    }
    this.object.visible = true;
  }
  hide(): void { this.object.visible = false; }
  dispose(): void { this.object.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}
