import { expect, it, vi } from "vitest";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, circleMesh } from "../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";

function renderer() {
  const builder = { getVerticesCount: () => 0, getIndicesCount: () => 0,
    appendVerticesInterleaved: vi.fn(), appendIndices: vi.fn(), isValid: () => true,
    updateMesh: vi.fn(), getMesh: () => ({}) };
  const mesh = Object.assign(Object.create(WorldMeshRenderer.prototype), {
    builder, visual: {}, object: { enabled: false }, lastVertices: [], lastIndices: [], triangleInput: null,
  }) as WorldMeshRenderer;
  return { mesh, builder };
}

it("does not upload unchanged mesh data and still observes mutable input changes", () => {
  const { mesh, builder } = renderer();
  const vertices = [0, 1, 2];
  mesh.upload(vertices, [0]); mesh.upload([...vertices], [0]);
  expect(builder.updateMesh).toHaveBeenCalledOnce();
  vertices[0] = 3; mesh.upload(vertices, [0]);
  expect(builder.updateMesh).toHaveBeenCalledTimes(2);
});

it("reuses bounded cached circle geometry without rebuilding stable vertices", () => {
  const first = circleMesh(6, .22), { mesh, builder } = renderer();
  expect(circleMesh(6, .22)).toBe(first);
  mesh.triangles(first.positions, first.indices, [1, 1, 1, .5]);
  mesh.hide(); mesh.triangles(first.positions, first.indices, [1, 1, 1, .5]);
  expect(builder.updateMesh).toHaveBeenCalledOnce();
  expect((mesh as any).object.enabled).toBe(true);
  mesh.triangles(first.positions, first.indices, [1, 1, 1, 1]);
  expect(builder.updateMesh).toHaveBeenCalledTimes(2);
});

it("keeps the native stroke vertex contract while supporting arm color and pixel width", () => {
  const upload = vi.fn();
  const stroke = Object.assign(Object.create(AdaptiveStrokeRenderer.prototype), {
    material: { mainPass: {} }, minimumPixels: 0.75, upload,
  }) as AdaptiveStrokeRenderer;
  stroke.segments([[10, 20, 30], [40, 50, 60]], 0.06, 0.8, 0.6, 1.8, false, [1, 0, 0]);
  const [vertices, indices] = upload.mock.calls[0];
  expect(vertices).toHaveLength(4 * 22);
  expect(indices).toEqual([0, 1, 2, 2, 1, 3]);
  expect(vertices.slice(6, 10)).toEqual([1, 0, 0, 0.8]);
  expect(vertices.slice(12, 16)).toEqual([40, 50, 60, 0]);
  expect(vertices.slice(19, 22)).toEqual([10, 20, 30]);
  expect((stroke.material.mainPass as any).minimumPixels).toBe(0.75);
});
