import { expect, test } from "@playwright/test";
import { bootstrap } from "./fixtures/Runtime";

test("replicates passive Spectacles cues, hides closed menus, and expires stale users", async ({ page }) => {
  const runtime = await bootstrap(page);
  await runtime.localized();
  runtime.send({ type: "localization_context", map_code: "office", odom_reference_id: "fixture-odom" });
  const state = { type: "presence_state", map_code: "office", odom_reference_id: "fixture-odom", clients: [{ client_id: "specs-peer", age_s: 0,
    pointers: [{ id: 0, start: [0,0,0], control: [.5,0,0], end: [1,0,0], opacity: .4, cursor: true }],
    panel: { position: [1,0,1], orientation: [0,0,0,1], width: .5, height: .3 } }] };
  runtime.send(state);
  const visible = () => page.evaluate(() => {
    const app = (window as any).xb.core.scene.children.find((o:any) => o.client?.manipulation);
    const cues = app.children.find((o:any) => o.name === "Remote interaction cues");
    const user = cues?.children[0];
    return user ? { count: user.children.length, panel: user.children[0].visible,
      passive: user.children.every((o:any) => !o.userData.rayTarget && !o.userData.touchButton) } : null;
  });
  await expect.poll(visible).toEqual({ count: 5, panel: true, passive: true });
  runtime.send({ ...state, clients: [{ ...state.clients[0], panel: null, pointers: [] }] });
  await expect.poll(visible).toEqual({ count: 5, panel: false, passive: true });
  await expect.poll(visible, { timeout: 5000 }).toBeNull();
  runtime.close();
});
