import * as THREE from "three";
import { expect, it } from "vitest";
import { WebXRLidarRenderer } from "../src/sensors/WebXRLidarRenderer";

it("renders LiDAR before UI without writing depth that can occlude panels", () => {
  const lidar = new WebXRLidarRenderer();
  expect(lidar.object.renderOrder).toBeLessThan(0);
  expect((lidar.object.material as THREE.PointsMaterial).depthWrite).toBe(false);
  expect(lidar.object.material.transparent).toBe(false);
  expect(lidar.object.material.blending).toBe(THREE.CustomBlending);
  lidar.dispose();
});



const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } as import("@dimos-ar-client/localization/clientTrackingOrigin").ClientTrackingOrigin;
it("uses reusable capped buffers, round sprites, stable height colors and red-transparent obstacle distance", () => {
  const lidar = new WebXRLidarRenderer();
  const points: import("@dimos-ar-client/websocket/protocolTypes").Vec3[] = [[0, 0, 0.1], [0.5, 0, 0.33], [0, 0, 2]];
  lidar.apply(points, origin, "full", [0, 0, 0.33], 0.33);
  const positions = lidar.object.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = lidar.object.geometry.getAttribute("color") as THREE.BufferAttribute;
  const versions = [positions.version, colors.version];
  expect(lidar.object.material.map).toBeInstanceOf(THREE.DataTexture);
  expect(lidar.object.material.alphaTest).toBeGreaterThan(0);
  expect(lidar.object.geometry.drawRange.count).toBe(3);
  const low = [colors.getX(0), colors.getY(0), colors.getZ(0)];
  expect(low).not.toEqual([colors.getX(2), colors.getY(2), colors.getZ(2)]);
  lidar.apply(points, origin, "full", [0, 0, 0.33], 0.33);
  expect([positions.version, colors.version]).toEqual(versions);
  lidar.apply([...points, [0, 0, 10]], origin, "full", [0, 0, 0.33], 0.33);
  expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual(low);
  lidar.apply([[0, 0, 0.33], [0.5, 0, 0.33]], origin, "obstacles", [0, 0, 0.33], 0.33);
  expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 0, 0]);
  expect([colors.getX(1), colors.getY(1), colors.getZ(1)]).toEqual([1, 0, 0]);
  expect(colors.getW(0)).toBe(1); expect(colors.getW(1)).toBeLessThan(1);
  lidar.apply(Array.from({ length: 6000 }, (_, i) => [i / 1000, 0, 0.4]), origin, "full");
  expect(lidar.object.geometry.getAttribute("position")).toBe(positions);
  expect(lidar.object.geometry.drawRange.count).toBe(4000);
  lidar.apply(points, origin, "off"); expect(lidar.object.visible).toBe(false);
  lidar.dispose();
});

it("fades to zero at 60 cm from rotated body bounds and restores opaque Full colours", () => {
  const lidar = new WebXRLidarRenderer();
  const points: import("@dimos-ar-client/websocket/protocolTypes").Vec3[] = [[0, 0.5, 0.4], [0, 0.8, 0.4], [0, 1.1, 0.4], [0, 1.2, 0.4]];
  lidar.apply(points, origin, "obstacles", [0, 0, 0.33], 0.33, [0, 0, Math.SQRT1_2, Math.SQRT1_2], [1, 0.4, 0.5]);
  const colors = lidar.object.geometry.getAttribute("color");
  expect(colors.itemSize).toBe(4); expect(colors.getW(0)).toBeCloseTo(1);
  expect(colors.getW(1)).toBeCloseTo(0.5); expect(colors.getW(2)).toBeCloseTo(0); expect(colors.getW(3)).toBe(0);
  lidar.apply(points, origin, "full"); expect(colors.getW(3)).toBe(1); lidar.dispose();
});

it("draws corrected coordinates once and keeps obstacle fade in native metres", () => {
  const lidar = new WebXRLidarRenderer();
  const robot: [number, number, number] = [5, -2.5, 0.33];
  const points: [number, number, number][] = [[6, -2.5, 0.4]];
  lidar.apply(points, origin, "obstacles", robot, 0.33, [0, 0, 0, 1], [1, 0.4, 0.5], 4000, 0.6, 1.25);
  const positions = lidar.object.geometry.getAttribute("position");
  const colors = lidar.object.geometry.getAttribute("color");
  // 0.8 native metres from center, 0.3 from a 1m body, halfway through a 0.6m halo.
  expect(colors.getW(0)).toBeCloseTo(0.5);
  expect(positions.getZ(0)).toBeCloseTo(-6);
  lidar.apply(points, origin, "obstacles", robot, 0.33, [0, 0, 0, 1], [1, 0.4, 0.5], 4000, 0.6, 1);
  expect(colors.getW(0)).toBeLessThan(0.5);
  lidar.dispose();
});
