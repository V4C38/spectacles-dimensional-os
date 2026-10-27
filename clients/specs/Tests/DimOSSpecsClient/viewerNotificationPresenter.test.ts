import { afterEach, expect, it, vi } from "vitest";
import { ViewerNotificationPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/ViewerNotificationPresenter";
import { circleMesh } from "../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";
afterEach(() => vi.unstubAllGlobals());
it("keeps cached circles immutable through repeated complete notification renders", () => {
  const originalQuat = quat;
  vi.stubGlobal("quat", class extends originalQuat { static angleAxis(angle: number, axis: vec3) { return new originalQuat(Math.cos(angle / 2), axis.x * Math.sin(angle / 2), axis.y * Math.sin(angle / 2), axis.z * Math.sin(angle / 2)); } });
  const ring = circleMesh(1.6, 0.22, 1, 48), positions = [...ring.positions], indices = [...ring.indices];
  const triangles = vi.fn(), transform = { getWorldPosition: () => vec3.zero(), getWorldRotation: () => quat.quatIdentity(), setWorldPosition: vi.fn(), setWorldRotation: vi.fn() };
  const presenter = Object.assign(Object.create(ViewerNotificationPresenter.prototype), {
    center: { tick() {}, snapshot: () => ({ notification: { text: "Emergency stop requested" }, elapsedS: 1 }) },
    root: { enabled: false, getTransform: () => transform }, text: {}, icon: { triangles }, camera: { getTransform: () => transform },
  }) as ViewerNotificationPresenter;
  for (let i = 0; i < 180; i++) presenter.tick(1 / 60);
  expect(ring.positions).toEqual(positions); expect(ring.indices).toEqual(indices);
  expect(Object.isFrozen(ring.positions)).toBe(true); expect(Object.isFrozen(ring.indices)).toBe(true);
  const first = triangles.mock.calls[0], last = triangles.mock.calls.at(-1)!;
  expect(last[0]).toEqual(first[0]); expect(last[1]).toEqual(first[1]);
  expect(last[0]).toHaveLength(positions.length + 12); expect(last[1]).toHaveLength(indices.length + 6);
});
