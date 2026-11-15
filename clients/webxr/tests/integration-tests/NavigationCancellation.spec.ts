import { expect, test } from "@playwright/test";
import { bootstrap } from "./fixtures/Runtime";

// Exercise the production host/session path against authoritative fixture replies.
test("cancels navigation without latching E-stop and permits the next goal", async ({ page }) => {
  const runtime = await bootstrap(page);
  await runtime.localized();
  const goal = (ts: number) => ({ type: "nav_goal", ts, pose: [3, 0, 0, 0], path_poses: [[2, 0, 0, 0], [3, 0, 0, 0]] });
  const inspect = () => page.evaluate(() => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((object: any) => object.client?.manipulation);
    return { flash: app.client.navigation.flash(), active: app.client.navigation.interaction.snapshot().goalActive,
      stopped: app.client.session.view().state?.safety?.stopped };
  });
  runtime.send(goal(100)); runtime.state("following_path");
  await expect.poll(async () => (await inspect()).active).toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    w.xb.core.scene.children.find((object: any) => object.client?.manipulation).client.cancelNavigation();
  });
  await expect.poll(async () => (await inspect()).flash).toBe("cancelled");
  expect(runtime.commands.some(command => command.type === "interaction_request" && command.action === "cancel_navigation" && command.goal_ts === 100)).toBe(true);
  expect(runtime.commands.some(command => command.type === "estop_request")).toBe(false);
  expect((await inspect()).stopped).toBe(false);
  runtime.send(goal(101)); runtime.state("following_path");
  await expect.poll(async () => (await inspect()).active).toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    w.xb.core.scene.children.find((object: any) => object.client?.manipulation).client.emergencyStop();
  });
  await expect.poll(async () => (await inspect()).stopped).toBe(true);
  expect(runtime.commands.filter(command => command.type === "estop_request")).toHaveLength(1);
  runtime.close();
});
