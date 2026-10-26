import { test, expect, type Page } from "@playwright/test";
import { bootstrap, snapshot } from "./fixtures/Runtime";
import { activateRuntimeButton, frameMenu, setSelection } from "./fixtures/Input";

async function markerState(page: Page, advance = 0) {
  return page.evaluate(advance => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    if (advance) w.advanceCancel(advance);
    const marker = app.client.navigation.marker;
    const button = marker.object.getObjectByName("Navigation cancel button");
    const connector = marker.object.getObjectByName("Navigation cancel connector");
    return { visible: marker.cancelVisible(), scale: button.scale.x, height: button.position.y,
      connectorVisible: connector.visible, connectorTop: connector.geometry.getAttribute("instanceEnd").getY(0) };
  }, advance);
}

async function frameWorld(page: Page, probe = false) {
  await page.evaluate(probe => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const marker = probe ? [...app.client.navigation.probes.values()][0].probe : app.client.navigation.marker.object;
    const target = marker.getWorldPosition(marker.position.clone()); target.y += 0.15;
    const eye = target.clone().add(target.clone().set(0, 0.6, 1.1));
    const rotation = marker.quaternion.clone().setFromUnitVectors(target.clone().set(0, 0, -1), target.clone().sub(eye).normalize());
    w.questDevice.position.set(eye.x, eye.y, eye.z);
    w.questDevice.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    document.body.style.background = "#182028";
    document.querySelector("canvas")!.style.background = "#182028";
  }, probe);
}

test("dismiss closes review; probes meet the ray; Cancel rises and grows with its dotted line", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const runtime = await bootstrap(page, "controller");
  const capture = async (name: string) => {
    await page.waitForTimeout(200);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path }); await info.attach(name, { path, contentType: "image/png" });
  };
  try {
    await runtime.localized();
    await page.evaluate(() => {
      const w = window as any;
      w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").client.ui.requestAlignmentReview("Tracking resumed");
    });
    await frameMenu(page);
    await activateRuntimeButton(page, "Dismiss");
    await expect.poll(() => snapshot(page).then(s => s.menuOpen || s.alignmentReview?.pending)).toBe(false);
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.setRobotSelected(true);
      const p = app.client.robot.worldPosition();
      w.questDevice.controllers.right.position.set(p[0] + 0.65, app.client.robot.floorWorldY() + 0.5, p[2]);
      w.questDevice.controllers.right.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
      w.questDevice.controllers.left.position.set(-5, 2, 0);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const probe = [...app.client.navigation.probes.values()][0] as any;
      if (!probe) return false;
      const circle = probe.probe.getObjectByName("Navigation probe circle");
      const hit = app.interaction.hit(w.xb.core.input.rightController);
      return circle.geometry.instanceCount === 128 && circle.material.uniforms.uGap.value > 0 &&
        !!hit && Math.abs(circle.getWorldPosition(circle.position.clone()).y - hit.point.y) < 0.00001;
    })).toBe(true);
    await frameWorld(page, true); await capture("small-dashed-probe-at-ray-end");
    await setSelection(page, 1); await setSelection(page, 0);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.client.navigation.isAiming();
    })).toBe(true);
    const previewArrow = await page.evaluate(() => {
      const w = window as any;
      const view = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").client.navigation.draftMarker;
      const arrow = view.object.getObjectByName("NavigationHeading");
      return { widthRatio: arrow.scale.x / arrow.scale.y, opacityRatio: arrow.material.opacity / view.circleOpacity() };
    });
    expect(previewArrow.widthRatio).toBeCloseTo(0.8); expect(previewArrow.opacityRatio).toBeCloseTo(0.8);
    await capture("thinner-preview-arrow");
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.setRobotSelected(false);
      const marker = app.client.navigation.marker;
      w.advanceCancel = marker.tick.bind(marker); marker.tick = () => {};
    });
    runtime.send({ type: "nav_goal", ts: Date.now(), pose: [2, 1, 0, 0], path_poses: [[2, 0, 0, 0], [2, 1, 0, 0]] });
    runtime.state("following_path");
    await expect.poll(() => markerState(page).then(s => s.visible)).toBe(true);
    await frameWorld(page);
    const start = await markerState(page);
    expect(start.scale).toBe(0); expect(start.height).toBeCloseTo(0.015); expect(start.connectorVisible).toBe(false);
    await capture("cancel-start-at-circle");
    const middle = await markerState(page, 0.14);
    expect(middle.scale).toBeCloseTo(0.5); expect(middle.height).toBeCloseTo(0.1975);
    expect(middle.connectorTop).toBeCloseTo(0.145);
    await capture("cancel-rising-halfway");
    const end = await markerState(page, 0.14);
    expect(end.scale).toBeCloseTo(1); expect(end.height).toBeCloseTo(0.38);
    expect(end.connectorTop).toBeCloseTo(0.275);
    await capture("cancel-arrived");
    expect(errors).toEqual([]);
  } finally { runtime.close(); }
});
