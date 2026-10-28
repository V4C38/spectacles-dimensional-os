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
