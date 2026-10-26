import { expect, test } from "@playwright/test";
import { bootstrap, snapshot } from "./fixtures/Runtime";
import { frameMenu, summonMenu, pointIndexAtButton } from "./fixtures/Input";


for (const pinch of [false, true]) test(`index fingertip activates a real menu button once (${pinch ? "with pinch" : "without pinch"})`, async ({ page }) => {
  test.setTimeout(90000);
  const runtime = await bootstrap(page);
  await runtime.localized(); await summonMenu(page); await frameMenu(page);
  expect((await snapshot(page)).operatingMode).toBe("manual");
  await page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    w.modeChanges = 0;
    const setMode = app.client.ui.setOperatingMode.bind(app.client.ui);
    app.client.ui.setOperatingMode = (mode: string) => { w.modeChanges++; return setMode(mode); };
  });
  await pointIndexAtButton(page, "Agent", 0.05);
  await pointIndexAtButton(page, "Agent", 0.02);
  await pointIndexAtButton(page, "Agent", 0.005);
  expect((await snapshot(page)).operatingMode).toBe("manual");
  if (pinch) {
    const { setSelection } = await import("./fixtures/Input");
    await setSelection(page, 1); await setSelection(page, 0);
  }
  await pointIndexAtButton(page, "Agent", 0.04);
  await expect.poll(() => snapshot(page).then(s => s.operatingMode)).toBe("agent");
  expect(await page.evaluate(() => (window as any).modeChanges)).toBe(1);
  expect(runtime.commands.filter(c => c.type === "nav_goal_request" && !c.preview)).toHaveLength(0);
});

test("detached unselected marker hovers and drags independently of the robot box", async ({ page }) => {
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
    const outline = app.client.robot.object.getObjectByName("Robot selection outline");
    return { hover: app.client.robot.hovered, opacity: outline.material.opacity, selected: app.client.isRobotSelected(), held: !!app.worldHold,
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
  await expect.poll(() => page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    return app.interaction.hoverTargets().some((hit: any) => {
      if (hit === app.client.navigation.marker.cancelObject) return false;
      for (let object = hit; object; object = object.parent) if (object === app.client.navigation.marker.object) return true;
      return false;
    });
  })).toBe(true);
  await expect.poll(() => read().then(s => s.hover)).toBe(false);
  await expect.poll(() => read().then(s => s.opacity)).toBeCloseTo(0, 2);
  const before = await read(); expect(before.selected).toBe(false);
  const { setSelection, moveInput } = await import("./fixtures/Input");
  await setSelection(page, 1); await expect.poll(() => read().then(s => s.held)).toBe(true);
  await moveInput(page, [0.3, 0, 0], 1200);
  const dragged = await read();
  expect(dragged.hover).toBe(false);
  expect(dragged.held && dragged.dragging).toBe(true);
  expect(dragged.pose.position[0]).toBeGreaterThan(before.pose.position[0] + 0.2);
  const [, y, , w] = dragged.pose.orientation;
  expect(Math.abs(2 * Math.atan2(y, w))).toBeGreaterThan(0.4);
  await setSelection(page, 0);
  expect((await read()).held).toBe(false);
});

for (const mode of ["hand", "controller"] as const) test(`deselecting a hovered robot keeps its box expanded (${mode})`, async ({ page }) => {
  test.setTimeout(90000);
  const runtime = await bootstrap(page, mode); await runtime.localized();
  await page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const p = app.client.robot.collider.getWorldPosition(app.mainMenu.panel.position.clone());
    const inputs = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers : w.questDevice.hands;
    inputs.right.position.set(p.x, p.y, p.z + 0.8);
    inputs.right.quaternion.set(0, 0, 0, 1);
    inputs.left.position.set(-5, 2, 0);
    app.client.setRobotSelected(true);
  });
  const read = () => page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const outline = app.client.robot.object.getObjectByName("Robot selection outline");
    return { hovered: app.client.robot.hovered, selected: app.client.isRobotSelected(),
      scale: outline.scale.toArray(), opacity: outline.material.opacity };
  });
  await expect.poll(read).toMatchObject({ hovered: true, selected: true, scale: [1, 1, 1] });
  await page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    w.boxSamples = [];
    const record = () => {
      const outline = app.client.robot.object.getObjectByName("Robot selection outline");
      w.boxSamples.push(outline.scale.toArray());
      if (w.recordBox) app.session.requestAnimationFrame(record);
    };
    w.recordBox = true;
    app.session.requestAnimationFrame(record);
  });
  const { setSelection } = await import("./fixtures/Input");
  await setSelection(page, 1);
  await expect.poll(read).toMatchObject({ hovered: true, selected: false, scale: [1, 1, 1] });
  await page.waitForTimeout(350);
  await setSelection(page, 0);
  await expect.poll(() => read().then(s => s.opacity)).toBeCloseTo(0.45, 2);
  const state = await read();
  expect(state).toMatchObject({ hovered: true, selected: false, scale: [1, 1, 1] });
  const samples = await page.evaluate(() => {
    const w = window as any; w.recordBox = false; return w.boxSamples as number[][];
  });
  expect(samples.length).toBeGreaterThan(2);
  expect(samples.every(scale => scale.every(value => value === 1))).toBe(true);
});

test("hovering navigation Cancel does not reveal the unselected robot box", async ({ page }) => {
  test.setTimeout(90000);
  const runtime = await bootstrap(page); await runtime.localized();
  runtime.send({ type: "nav_goal", pose: [3, 0.5, 0, 0], path_poses: [[2, 0, 0, 0], [3, 0.5, 0, 0]], ts: Date.now() / 1000 });
  runtime.state("following_path");
  await expect.poll(() => page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    return app.client.navigation.marker.cancelVisible() && !app.client.navigation.marker.cancelObject.userData.rayDisabled;
  })).toBe(true);
  await page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const cancel = app.client.navigation.marker.cancelObject;
    const p = cancel.getWorldPosition(app.mainMenu.panel.position.clone());
    const q = cancel.getWorldQuaternion(app.mainMenu.panel.quaternion.clone());
    const direction = p.clone().set(0, 0, 0.5).applyQuaternion(q);
    w.questDevice.hands.right.position.copy(p.add(direction));
    w.questDevice.hands.right.quaternion.copy(q);
    w.questDevice.hands.left.position.set(-5, 2, 0);
  });
  await expect.poll(() => page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    return app.interaction.hoverTargets().includes(app.client.navigation.marker.cancelObject);
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    return { hover: app.client.robot.hovered, selected: app.client.isRobotSelected(),
      opacity: app.client.robot.object.getObjectByName("Robot selection outline").material.opacity };
  })).toEqual({ hover: false, selected: false, opacity: 0 });
});
