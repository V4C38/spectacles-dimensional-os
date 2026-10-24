import * as THREE from "three";
import { expect, it } from "vitest";
import { WebXRLidarRenderer } from "../src/sensors/WebXRLidarRenderer";

it("renders LiDAR before UI without writing depth that can occlude panels", () => {
  const lidar = new WebXRLidarRenderer();
  expect(lidar.object.renderOrder).toBeLessThan(0);
  expect((lidar.object.material as THREE.PointsMaterial).depthWrite).toBe(false);
  expect(lidar.object.material.transparent).toBe(false);
  lidar.dispose();
});



const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } as import("@dimos-ar-client/localization/clientTrackingOrigin").ClientTrackingOrigin;
it("uses reusable capped buffers, round sprites, stable height colors and red-white obstacle distance", () => {
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
  expect([colors.getX(1), colors.getY(1), colors.getZ(1)]).toEqual([1, 1, 1]);
  lidar.apply(Array.from({ length: 6000 }, (_, i) => [i / 1000, 0, 0.4]), origin, "full");
  expect(lidar.object.geometry.getAttribute("position")).toBe(positions);
  expect(lidar.object.geometry.drawRange.count).toBe(4000);
  lidar.apply(points, origin, "off"); expect(lidar.object.visible).toBe(false);
  lidar.dispose();
});
