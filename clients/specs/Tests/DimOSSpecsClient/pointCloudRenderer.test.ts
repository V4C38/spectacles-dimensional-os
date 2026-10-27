import { clientTrackingToOdomPoint } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms";
import { beforeEach, expect, it, vi } from "vitest";
import { PointCloudRenderer, composeLidarPoint } from "../../Assets/Scripts/DimOSSpecsClient/sensors/PointCloudRenderer";

function harness() {
  const vertices: number[][] = [];
  const builder = { getVerticesCount: () => 0, getIndicesCount: () => 0,
    appendVerticesInterleaved: (data: number[]) => vertices.push(data), appendIndices: vi.fn(),
    isValid: () => true, updateMesh: vi.fn(), getMesh: () => ({}) };
  const transform = { setWorldPosition: vi.fn(), setWorldRotation: vi.fn(), setWorldScale: vi.fn() };
  const renderer = Object.assign(new PointCloudRenderer(), { visual: { enabled: false, mainMaterial: { mainPass: {} } },
    builder, getSceneObject: () => ({ getTransform: () => transform }) });
  return { renderer, vertices, builder, transform };
}
const origin: any = { position: [1, -2, .4], orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], confidence: 1, ts: 1 };

it("composes points exactly once and keeps an authored ancestor out of world geometry", () => {
  const h = harness(), point: any = [2, -2, 1];
  h.renderer.apply({ points: [point], origin });
  expect(h.transform.setWorldPosition).toHaveBeenCalledWith(vec3.zero());
  expect(h.transform.setWorldRotation).toHaveBeenCalledWith(quat.quatIdentity());
  expect(h.transform.setWorldScale).toHaveBeenCalledWith(vec3.one());
  expect(h.vertices[0].slice(0, 3)).toEqual(composeLidarPoint(point, origin));
});

it("does not rebuild a stable cloud and applies native odometry scale to clearance", () => {
  const h = harness(), points: any = [[.9375, 0, 0]];
  const input: any = { points, origin, mode: "obstacles", robot: [0, 0, 0], orientation: [0, 0, 0, 1],
    bounds: [.7, .5, .55], obstacleRangeM: .6, odomScaleCorrectionFactor: 1.25 };
  h.renderer.apply(input); h.renderer.apply(input);
  expect(h.builder.updateMesh).toHaveBeenCalledOnce();
  const t = (.9375 / 1.25 - .35) / .6;
  expect(h.vertices[0][6]).toBeCloseTo(1 - t * t * (3 - 2 * t));
  h.renderer.apply({ ...input, odomScaleCorrectionFactor: 1 });
  expect(h.builder.updateMesh).toHaveBeenCalledTimes(2);
  expect(h.vertices[1][6]).toBeLessThan(h.vertices[0][6]);
});

it("keeps full-cloud geometry and colors stable when only robot XY or heading changes", () => {
  const h = harness(), points: any = [[1, 2, .3], [2, 3, .5]];
  const input: any = { points, origin, mode: "full", robot: [0, 0, .33], baseHeightM: .33 };
  h.renderer.apply(input);
  const composed = (h.renderer as any).positions;
  h.renderer.apply({ ...input, robot: [100, -50, .33], orientation: [0, 0, 1, 0] });
  expect(h.builder.updateMesh).toHaveBeenCalledOnce();
  expect((h.renderer as any).positions).toBe(composed);
  h.renderer.apply({ ...input, mode: "obstacles", obstacleRangeM: .4 });
  expect((h.renderer as any).positions).toBe(composed);
});

it("preserves measured 1/2/3 metre distances through translated and rotated localization origins", () => {
  for (const yaw of [0, 0.7, Math.PI / 2]) {
    const origin = { position: [4, -2, .33] as [number, number, number],
      orientation: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)] as [number, number, number, number], confidence: 1, ts: 0 };
    for (const depth of [1, 2, 3]) {
      const point = clientTrackingToOdomPoint([depth, .2, .4], origin);
      const world = composeLidarPoint(point, origin);
      expect(world[0]).toBeCloseTo(-20, 8); expect(world[1]).toBeCloseTo(40, 8); expect(world[2]).toBeCloseTo(-depth * 100, 8);
    }
  }
});
it("reports the actual native parent transform and projected sample without changing the cloud", () => {
  const h = harness(); h.renderer.apply({ points: [[1, 0, 0], [2, 0, 0], [3, 0, 0]],
    origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } });
  Object.assign(h.transform, { getWorldTransform: () => ({ multiplyPoint: (point: vec3) => point.add(new vec3(30, 0, 0)) }) });
  const camera = { worldSpaceToScreenSpace: (point: vec3) => ({ x: point.x / 100, y: point.z / 100 }) } as Camera;
  const before = h.vertices.length;
  const diagnostic = h.renderer.spatialDiagnostics(camera) as any;
  expect(diagnostic.samples[0]).toMatchObject({ odom: [1, 0, 0], worldCm: [0, 0, -100], renderedWorldCm: [30, 0, -100], screen: [.3, -1] });
  expect(diagnostic.samples).toHaveLength(3); expect(h.vertices).toHaveLength(before);
});

it("distinguishes existing server XY scale from native range without silently rescaling vertices", () => {
  const h = harness();
  h.renderer.apply({ points: [[1.5, 0, 0]], robot: [0, 0, 0], odomScaleCorrectionFactor: 1.25,
    origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } });
  Object.assign(h.transform, { getWorldTransform: () => ({ multiplyPoint: (point: vec3) => point }) });
  const camera = { worldSpaceToScreenSpace: () => ({ x: .5, y: .5 }) } as unknown as Camera;
  const diagnostic = h.renderer.spatialDiagnostics(camera) as any;
  expect(diagnostic.samples[0]).toMatchObject({ correctedPlanarDistanceM: 1.5, nativePlanarDistanceM: 1.2 });
  expect(diagnostic.odomScaleCorrectionFactor).toBe(1.25);
  expect(h.vertices[0].slice(0, 3)).toEqual([0, 0, -150]);
});
