import { expect, test, type Page } from "@playwright/test";
import { bootstrap, snapshot } from "./fixtures/Runtime";
import { frameMenu, summonMenu } from "./fixtures/Input";

async function indexAt(page: Page, label: string, distance: number): Promise<void> {
  await page.evaluate(async ({ label, distance }) => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const button = app.mainMenu.panel.getObjectByName(`Button: ${label}`);
    await new Promise<void>(resolve => app.session.requestAnimationFrame((_time: number, frame: XRFrame) => {
      const source = Array.from(app.session.inputSources as XRInputSource[]).find(s => s.hand && s.handedness === "right")!;
      const tip = frame.getJointPose!(source.hand!.get("index-finger-tip")!, app.reference)!.transform.position;
      const normal = app.mainMenu.panel.position.clone().set(0, 0, 1).applyQuaternion(button.getWorldQuaternion(app.mainMenu.panel.quaternion.clone()));
      const goal = button.getWorldPosition(app.mainMenu.panel.position.clone()).addScaledVector(normal, distance);
      const hand = w.questDevice.hands.right;
      hand.updatePinchValue(0);
      hand.position.set(hand.position.x + goal.x - tip.x, hand.position.y + goal.y - tip.y, hand.position.z + goal.z - tip.z);
      resolve();
    }));
  }, { label, distance });
  await page.waitForTimeout(180);
}

test("index fingertip activates a real menu button without a pinch and only once", async ({ page }) => {
  test.setTimeout(90000);
  const runtime = await bootstrap(page);
  await runtime.localized(); await summonMenu(page); await frameMenu(page);
  expect((await snapshot(page)).operatingMode).toBe("manual");
  await indexAt(page, "Agent", 0.05);
  await indexAt(page, "Agent", 0.02);
  await indexAt(page, "Agent", 0.005);
  expect((await snapshot(page)).operatingMode).toBe("manual");
  await indexAt(page, "Agent", 0.04);
  await expect.poll(() => snapshot(page).then(s => s.operatingMode)).toBe("agent");
  expect(runtime.commands.filter(c => c.type === "nav_goal_request" && !c.preview)).toHaveLength(0);
});

test("unselected marker keeps its grip and turns with the drag, without retaining robot hover", async ({ page }) => {
  test.setTimeout(90000);
  const runtime = await bootstrap(page); await runtime.localized();
  await page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const p = app.client.robot.collider.getWorldPosition(app.mainMenu.panel.position.clone());
    w.questDevice.hands.right.position.set(p.x, p.y, p.z + 0.8);
    w.questDevice.hands.right.quaternion.set(0, 0, 0, 1);
    w.questDevice.hands.left.position.set(-5, 2, 0);
  });
  const read = () => page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    return { hover: app.client.robot.hovered, selected: app.client.isRobotSelected(), held: !!app.worldHold,
      dragging: app.client.navigation.isDragging(), pose: app.client.navigation.marker.pose() };
  });
  await expect.poll(() => read().then(s => s.hover)).toBe(true);
  runtime.send({ type: "nav_goal", pose: [3, 0.5, 0, 0], path_poses: [[2, 0, 0, 0], [3, 0.5, 0, 0]], ts: Date.now() / 1000 });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const p = app.client.navigation.marker.pose().position;
    w.questDevice.hands.right.position.set(p[0], p[1] + 0.5, p[2] + 0.5);
    w.questDevice.hands.right.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
  });
  await expect.poll(() => read().then(s => s.hover)).toBe(false);
  const before = await read(); expect(before.selected).toBe(false);
  const { setSelection, moveInput } = await import("./fixtures/Input");
  await setSelection(page, 1); await expect.poll(() => read().then(s => s.held)).toBe(true);
  await moveInput(page, [0.3, 0, 0], 1200);
  const dragged = await read();
  expect(dragged.held && dragged.dragging).toBe(true);
  expect(dragged.pose.position[0]).toBeGreaterThan(before.pose.position[0] + 0.2);
  const [, y, , w] = dragged.pose.orientation;
  expect(Math.abs(2 * Math.atan2(y, w))).toBeGreaterThan(0.4);
  await setSelection(page, 0);
  expect((await read()).held).toBe(false);
});
