import * as THREE from "three";
import { expect, it } from "vitest";
import { WebXRLidarRenderer } from "../src/sensors/WebXRLidarRenderer";

it("renders LiDAR before UI without writing depth that can occlude panels", () => {
  const lidar = new WebXRLidarRenderer();
  expect(lidar.object.renderOrder).toBeLessThan(0);
  expect((lidar.object.material as THREE.PointsMaterial).depthWrite).toBe(false);
  expect(lidar.object.material.transparent).toBe(false);
  expect((lidar.object.material as THREE.PointsMaterial).size).toBe(.024);
  expect(lidar.object.material.blending).toBe(THREE.CustomBlending);
  lidar.dispose();
});



const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], alignment_id: "fixture-alignment", shared_frame_id: "fixture-map", odom_reference_id: "fixture-odom", tracking_reference_id: "fixture-tracking", confidence: 1, ts: 0 } as import("@dimos-ar-client/localization/ClientTracking").ClientTrackingOrigin;
it("uses reusable capped buffers, round sprites, stable height colors and red-transparent obstacle distance", () => {
  const lidar = new WebXRLidarRenderer();
  const points: import("@dimos-ar-client/ClientContracts").Vec3[] = [[0, 0, 0.1], [0.5, 0, 0.33], [0, 0, 2]];
  lidar.apply({ points, origin, mode: "full", robot: [0, 0, 0.33], baseHeightM: 0.33 });
  const positions = lidar.object.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = lidar.object.geometry.getAttribute("color") as THREE.BufferAttribute;
  const versions = [positions.version, colors.version];
  expect(lidar.object.material.map).toBeInstanceOf(THREE.DataTexture);
  expect(lidar.object.material.alphaTest).toBeGreaterThan(0);
  expect(lidar.object.geometry.drawRange.count).toBe(3);
  const low = [colors.getX(0), colors.getY(0), colors.getZ(0)];
  expect(low).not.toEqual([colors.getX(2), colors.getY(2), colors.getZ(2)]);
  lidar.apply({ points, origin, mode: "full", robot: [0, 0, 0.33], baseHeightM: 0.33 });
  expect([positions.version, colors.version]).toEqual(versions);
  lidar.apply({ points: [...points, [0, 0, 10]], origin, mode: "full", robot: [0, 0, 0.33], baseHeightM: 0.33 });
  expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual(low);
  lidar.apply({ points: [[0, 0, 0.33], [0.5, 0, 0.33]], origin, mode: "obstacles", robot: [0, 0, 0.33], baseHeightM: 0.33 });
  expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 0, 0]);
  expect([colors.getX(1), colors.getY(1), colors.getZ(1)]).toEqual([1, 0, 0]);
  expect(colors.getW(0)).toBe(1); expect(colors.getW(1)).toBeLessThan(1);
  lidar.apply({ points: Array.from({ length: 6000 }, (_, i) => [i / 1000, 0, 0.4]), origin, mode: "full" });
  expect(lidar.object.geometry.getAttribute("position")).toBe(positions);
  expect(lidar.object.geometry.drawRange.count).toBe(4000);
  lidar.apply({ points, origin, mode: "off" }); expect(lidar.object.visible).toBe(false);
  lidar.dispose();
});

it("fades to zero at 60 cm from rotated body bounds and restores opaque Full colours", () => {
  const lidar = new WebXRLidarRenderer();
  const points: import("@dimos-ar-client/ClientContracts").Vec3[] = [[0, 0.5, 0.4], [0, 0.8, 0.4], [0, 1.1, 0.4], [0, 1.2, 0.4]];
  lidar.apply({ points, origin, mode: "obstacles", robot: [0, 0, 0.33], baseHeightM: 0.33, orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], bounds: [1, 0.4, 0.5] });
  const colors = lidar.object.geometry.getAttribute("color");
  expect(colors.itemSize).toBe(4); expect(colors.getW(0)).toBeCloseTo(1);
  expect(colors.getW(1)).toBeCloseTo(0.5); expect(colors.getW(2)).toBeCloseTo(0); expect(colors.getW(3)).toBe(0);
  lidar.apply({ points, origin, mode: "full" }); expect(colors.getW(3)).toBe(1); lidar.dispose();
});

it("renders metric map positions once and measures obstacle clearance directly", () => {
  const lidar = new WebXRLidarRenderer();
  lidar.apply({ points: [[5.8, -2.5, 0.4]], origin, mode: "obstacles", robot: [5, -2.5, .33],
    orientation: [0, 0, 0, 1], bounds: [1, .4, .5], obstacleRangeM: .6 });
  expect(lidar.object.geometry.getAttribute("color").getW(0)).toBeCloseTo(.5);
  expect(lidar.object.geometry.getAttribute("position").getZ(0)).toBeCloseTo(-5.8);
  lidar.dispose();
});


it("scales the near and far screen-space point clamps by the same 1.5 factor", () => {
  const lidar = new WebXRLidarRenderer();
  try {
    const shader = { vertexShader: "#include <logdepthbuf_vertex>", fragmentShader: "#include <color_fragment>", uniforms: {} };
    lidar.object.material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain("clamp(gl_PointSize, 3.75, 12.0)");
  } finally { lidar.dispose(); }
});
