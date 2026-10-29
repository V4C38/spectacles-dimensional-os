import { afterEach, expect, it, vi } from "vitest";
import { ViewerNotificationPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/ViewerNotificationPresenter";
import { notificationGlyph } from "../../Assets/Scripts/DimOSARClient/presentation/NotificationCenter";
afterEach(() => vi.unstubAllGlobals());
it.each(["stop", "warning"] as const)("renders the shared %s glyph consistently across repeated frames", (glyph) => {
  const originalQuat = quat;
  vi.stubGlobal("quat", class extends originalQuat { static angleAxis(angle: number, axis: vec3) { return new originalQuat(Math.cos(angle / 2), axis.x * Math.sin(angle / 2), axis.y * Math.sin(angle / 2), axis.z * Math.sin(angle / 2)); } });
  const segments = notificationGlyph(glyph, 1);
  const triangles = vi.fn(), transform = { getWorldPosition: () => vec3.zero(), getWorldRotation: () => quat.quatIdentity(), setWorldPosition: vi.fn(), setWorldRotation: vi.fn() };
  const presenter = Object.assign(Object.create(ViewerNotificationPresenter.prototype), {
    center: { tick() {}, snapshot: () => ({ notification: { text: "Notification", glyph, tone: glyph === "warning" ? "warning" : "danger" }, elapsedS: 1 }) },
    root: { enabled: false, getTransform: () => transform }, text: {}, icon: { triangles }, camera: { getTransform: () => transform },
  }) as ViewerNotificationPresenter;
  for (let i = 0; i < 180; i++) presenter.tick(1 / 60);
  expect(notificationGlyph(glyph, 1)).toEqual(segments);
  const first = triangles.mock.calls[0], last = triangles.mock.calls.at(-1)!;
  expect(last[0]).toEqual(first[0]); expect(last[1]).toEqual(first[1]);
  expect(last[0]).toHaveLength(segments.length * 12); expect(last[1]).toHaveLength(segments.length * 6);
  expect(last[2]).toEqual(glyph === "warning" ? [1, 0.84, 0.04, 1] : [1, 0.27, 0.23, 1]);
});
