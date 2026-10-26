import { expect, it, vi } from "vitest";
import { WorldMeshRenderer, circleMesh } from "../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";

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
