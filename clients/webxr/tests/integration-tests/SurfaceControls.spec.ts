import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { bootstrap } from "./fixtures/Runtime";
import { activateRuntimeButton, frameMenu, pointRuntimeButton, setSelection, summonMenu } from "./fixtures/Input";

test("solid controls retain their depth and front-face interaction from oblique views", async ({ page }, info) => {
  test.setTimeout(120000);
  const recordingStart = Date.now();
  const scenes: { name: string; at: number }[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const runtime = await bootstrap(page, "controller");
  const capture = async (name: string) => {
    await page.waitForTimeout(600);
    scenes.push({ name, at: (Date.now() - recordingStart) / 1000 });
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: "image/png" });
  };
  try {
    await runtime.localized();
    await summonMenu(page);
    await frameMenu(page, true);
    await activateRuntimeButton(page, "Robot selection button");
    await activateRuntimeButton(page, "Agent");
    await frameMenu(page, true);
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((node: any) => node.constructor.name === "WebXRApp");
      app.menuAnchor.detach(); app.setupPlacement.pin();
      app.client.speech.setDraft("Inspect the kitchen");
      w.surfaceReview = { speech: app.client.speech, menu: app.mainMenu, rotation: app.mainMenu.panel.quaternion.clone(), scale: app.mainMenu.panel.scale.x };
      w.questDevice.controllers.right.position.set(1, 0.5, -0.2);
      w.questDevice.controllers.left.position.set(-1, 0.5, -0.2);
    });
    await capture("front-resting");
    await page.evaluate(() => {
      const { menu, rotation } = (window as any).surfaceReview;
      const turn = rotation.clone().setFromAxisAngle(menu.panel.position.clone().set(0, 1, 0), 0.5);
      menu.panel.quaternion.copy(rotation).multiply(turn);
    });
    await capture("oblique-resting");
    const shadow = () => page.evaluate(() => {
      const button = (window as any).surfaceReview.menu.clear;
      const footprint = button.getObjectByName("Button footprint");
      return { visible: footprint.visible, x: footprint.position.x, y: footprint.position.y,
        width: footprint.material.uniforms.uSize.value.x, blur: footprint.material.uniforms.uBlur.value };
    });
    const restingShadow = await shadow();
    expect(restingShadow.visible).toBe(false);
    await pointRuntimeButton(page, "Clear");
    await capture("oblique-hover");
    const raisedShadow = await shadow();
    expect(raisedShadow.visible).toBe(true);
    expect(raisedShadow.x).toBeGreaterThan(restingShadow.x);
    expect(raisedShadow.y).toBeLessThan(restingShadow.y);
    expect(raisedShadow.width).toBeGreaterThan(restingShadow.width);
    expect(raisedShadow.blur).toBeGreaterThan(restingShadow.blur);
    const depth = () => page.evaluate(() => {
      const button = (window as any).runtimeButton;
      return -button.getObjectByName("Button footprint").position.z * button.getWorldScale(button.position.clone()).z;
    });
    expect(await depth()).toBeCloseTo(0.006925, 4);
    await setSelection(page, 1);
    await capture("oblique-pressed");
    expect(await depth()).toBeCloseTo(0.005125, 4);
    await setSelection(page, 0);
    await activateRuntimeButton(page, "Manual");
    await capture("oblique-selected-tab");
    await activateRuntimeButton(page, "Agent");
    await page.evaluate(() => {
      const { menu, scale, speech } = (window as any).surfaceReview;
      menu.panel.scale.setScalar(scale * 1.2);
      speech.setDraft("");
      (window as any).questDevice.controllers.right.position.set(1, 0.5, -0.2);
    });
    await capture("oblique-resized-disabled");
    const controls = await page.evaluate(() => {
      const { menu } = (window as any).surfaceReview;
      const results: { name: string; thickness: number; expected: number; bodies: number; visible: boolean; opacity: number; depthWrite: boolean }[] = [];
      menu.panel.traverse((node: any) => {
        if (!node.mesh?.userData.touchButton) return;
        const bodies = node.mesh.children.filter((child: any) => child.name === "Surface thickness");
        const body = bodies[0];
        const scale = node.mesh.getWorldScale(node.position.clone()).z;
        let visible = true;
        for (let parent = node; parent; parent = parent.parent) visible = visible && parent.visible;
        results.push({ name: node.text || node.name, thickness: body.scale.z * scale,
          expected: ((node.variant === "primary" ? 0.009 : 0.005) + 0.0001) * 0.75, bodies: bodies.length, visible, opacity: body.material.opacity, depthWrite: body.material.depthWrite });
      });
      return results;
    });
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      expect(control.bodies, control.name).toBe(1);
      expect(control.depthWrite, control.name).toBe(true);
      if (control.visible) expect(control.opacity, control.name).toBe(1);
      expect(control.thickness, control.name).toBeCloseTo(control.expected, 7);
    }
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
    await writeFile(info.outputPath("review-scenes.json"), JSON.stringify({ scenes }, null, 2));
  }
});
