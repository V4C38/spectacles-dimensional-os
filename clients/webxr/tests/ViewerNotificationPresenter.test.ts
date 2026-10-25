import { expect, it } from "vitest";
import { ViewerNotificationPresenter } from "../src/presentation/ViewerNotificationPresenter";

it("snaps into the upper view, follows smoothly, refreshes urgent feedback and expires in visible time", () => {
  const view = new ViewerNotificationPresenter();
  const tick = (dt: number, x = 0) => view.tick([x, 1.6, 0], [0, 0, 0, 1], 2, dt);
  view.show({ text: "Emergency stop requested", glyph: "cross", priority: 100 });
  tick(0.1);
  expect(view.object.position.toArray()).toEqual([0, 1.3975, -0.9]);
  tick(0.1, 1); expect(view.object.position.x).toBeGreaterThan(0); expect(view.object.position.x).toBeLessThan(1);
  view.show({ text: "Ordinary notice", durationS: 0.01 }); tick(0.1);
  expect(view.object.visible).toBe(true);
  tick(2.1); view.show({ text: "Emergency stop", glyph: "cross", priority: 100 }); tick(0.2);
  expect(view.object.visible).toBe(true);
  tick(2.4); expect(view.object.visible).toBe(false);
  view.dispose();
});
