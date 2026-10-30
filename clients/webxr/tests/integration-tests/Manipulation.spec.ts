import { expect, test, type Page } from "@playwright/test";
import { bootstrap } from "./fixtures/Runtime";
import { setSelection } from "./fixtures/Input";
import { saveCaseProof } from "./fixtures/CaseProof";

test.afterEach(async ({}, info) => {
  await saveCaseProof(info, []);
});

async function aimHandle(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
    if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
    const handle = app.client.manipulation.renderer.handle.object;
    const p = handle.getWorldPosition(handle.position.clone());
    w.questDevice.controllers.right.position.set(p.x, p.y, p.z + 0.7);
    w.questDevice.controllers.right.quaternion.set(0, 0, 0, 1);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as any,
          app = w.xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
        return app.interaction.hit(w.xb.core.input.rightController)?.object
          .name;
      }),
    )
    .toBe("EndEffectorHandleCollider");
}

test("plans with a mesh ghost and follows only during an unselected grab", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /WebGLProgram|shader error|GL_INVALID/i.test(message.text())
    )
      errors.push(message.text());
  });
  const fixture = await bootstrap(page, "controller", { manipulation: true });
  try {
    await fixture.localized();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return app.client.manipulation.renderer.ghosts.size;
        }),
      )
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      let meshes = 0, normals = 0;
      for (const visual of app.client.manipulation.renderer.ghosts.values())
        visual.traverse((part: any) => {
          if (part.isMesh) { meshes++; if (part.geometry.getAttribute("normal")) normals++; }
        });
      return meshes > 0 && meshes === normals;
    })).toBe(true);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.setRobotSelected(true);
    });
    await aimHandle(page);
    await setSelection(page, 1);
    await page.evaluate(() => {
      (window as any).questDevice.controllers.right.position.y += 0.08;
    });
    await expect
      .poll(() =>
        fixture.commands.some(
          (c) => c.type === "manipulation_request" && c.action === "evaluate",
        ),
      )
      .toBe(true);
    await setSelection(page, 0);
    expect(
      fixture.commands.some(
        (c) => c.action === "acquire" || c.action === "update",
      ),
    ).toBe(false);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.manipulation.action("plan");
    });
    await expect
      .poll(() => fixture.commands.some((c) => c.action === "plan"))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return app.client.manipulation.interaction.plan?.plan_id;
        }),
      )
      .toBe("fixture-plan");
    const savedHead = await page.evaluate(() => {
      const w = window as any,
        head = w.questDevice;
      const saved = {
        position: [head.position.x, head.position.y, head.position.z],
        rotation: [
          head.quaternion.x,
          head.quaternion.y,
          head.quaternion.z,
          head.quaternion.w,
        ],
      };
      head.position.set(0.6, 1.35, -0.45);
      head.quaternion.set(-0.122, 0.31, 0.04, 0.942);
      head.quaternion.normalize();
      w.questDevice.controllers.right.position.set(1.5, 0.5, -0.3);
      return saved;
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: info.outputPath("manipulation-plan.png") });
    await page.evaluate((saved) => {
      const h = (window as any).questDevice;
      h.position.set(...saved.position);
      h.quaternion.set(...saved.rotation);
    }, savedHead);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.manipulation.action("execute");
    });
    await expect
      .poll(() => fixture.commands.find((c) => c.action === "execute")?.plan_id)
      .toBe("fixture-plan");
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.setRobotSelected(false);
    });
    await aimHandle(page);
    await setSelection(page, 1);
    await expect
      .poll(() => fixture.commands.some((c) => c.action === "acquire"))
      .toBe(true);
    await page.evaluate(() => {
      (window as any).questDevice.controllers.right.position.x += 0.08;
    });
    await expect
      .poll(() => fixture.commands.some((c) => c.action === "update"))
      .toBe(true);
    await page.waitForTimeout(1000);
    await setSelection(page, 0);
    await expect
      .poll(() => fixture.commands.some((c) => c.action === "release"))
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("manipulation speed slider captures a controller drag", async ({
  page,
}) => {
  const fixture = await bootstrap(page, "controller", { manipulation: true });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      if (!app.client.ui.menuOpen) app.client.ui.toggleMenu();
      app.mainMenu.settingsOpen = true;
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      const hit = app.mainMenu.speedSlider.hit;
      hit.updateWorldMatrix(true, false);
      const p = hit.getWorldPosition(hit.position.clone());
      const q = hit.getWorldQuaternion(hit.quaternion.clone());
      const n = p.clone().set(0, 0, 1).applyQuaternion(q);
      p.addScaledVector(n, 0.4);
      const c = w.questDevice.controllers.right;
      c.position.set(p.x, p.y, p.z);
      c.quaternion.set(q.x, q.y, q.z, q.w);
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const w = window as any;
          const app = w.xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return (
            app.interaction.hit(w.xb.core.input.rightController)?.object
              .userData.manipulationSpeedSlider === true
          );
        }),
      )
      .toBe(true);
    await setSelection(page, 1);
    const before = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      return app.client.manipulation.interaction.speedScale;
    });
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      const hit = app.mainMenu.speedSlider.hit;
      const q = hit.getWorldQuaternion(hit.quaternion.clone());
      const axis = hit.position
        .clone()
        .set(1, 0, 0)
        .applyQuaternion(q)
        .multiplyScalar(0.06);
      const p = w.questDevice.controllers.right.position;
      p.set(p.x + axis.x, p.y + axis.y, p.z + axis.z);
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const w = window as any;
          return w.xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          ).client.manipulation.interaction.speedScale;
        }),
      )
      .toBeGreaterThan(before + 0.15);
    await setSelection(page, 0);
  } finally {
    fixture.close();
  }
});

test("hand tracking keeps the gripper usable by the other hand during following", async ({ page }) => {
  test.setTimeout(90000);
  const fixture = await bootstrap(page, "hand", { manipulation: true });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      const p = app.client.manipulation.renderer.handle.object.getWorldPosition(app.client.manipulation.renderer.handle.object.position.clone());
      w.questDevice.hands.right.position.set(p.x, p.y, p.z + 0.7);
      w.questDevice.hands.right.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.rightController)?.object.name;
    })).toBe("EndEffectorHandleCollider");
    await setSelection(page, 1);
    await expect.poll(() => fixture.commands.some(c => c.action === "acquire")).toBe(true);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      w.questDevice.hands.right.position.y += 0.05;
    });
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.client.manipulation.renderer.gripperMenu.scale.x;
    })).toBeGreaterThan(0.999);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const button = app.client.manipulation.renderer.gripperMenu.children[0];
      const p = button.getWorldPosition(button.position.clone()), q = button.getWorldQuaternion(button.quaternion.clone());
      const normal = p.clone().set(0, 0, 1).applyQuaternion(q); p.addScaledVector(normal, 0.5);
      w.questDevice.hands.left.position.set(p.x, p.y, p.z);
      w.questDevice.hands.left.quaternion.set(q.x, q.y, q.z, q.w);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.leftController)?.object.userData.manipulationAction;
    })).toBe("gripper");
    await page.evaluate(async () => {
      const w = window as any, session = w.xb.core.renderer.xr.getSession();
      w.questDevice.hands.left.updatePinchValue(1);
      await new Promise<void>(resolve => session.requestAnimationFrame(() => session.requestAnimationFrame(() => resolve())));
      w.questDevice.hands.left.updatePinchValue(0);
    });
    await expect.poll(async () => JSON.stringify({
      count: fixture.commands.filter(c => c.action === "gripper").length,
      state: await page.evaluate(() => {
        const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
        return { holding: !!app.inputController.manipulationHold, fresh: app.client.manipulation.interaction.feedbackFresh,
          selected: app.client.isRobotSelected(), dragging: app.client.manipulation.interaction.dragging,
          following: app.client.manipulation.interaction.following, status: app.client.manipulation.interaction.status,
          hit: app.interaction.hit(w.xb.core.input.leftController)?.object.userData.manipulationAction };
      }),
    })).toContain('"count":1');
    expect(fixture.commands.some(c => c.action === "release")).toBe(false);
    await expect.poll(() => fixture.commands.some(c => c.action === "update")).toBe(true);
    await setSelection(page, 0);
    await expect.poll(() => fixture.commands.some(c => c.action === "release")).toBe(true);
  } finally { await fixture.close(); }
});
