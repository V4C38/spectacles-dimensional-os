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
    expect(
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.constructor.name === "WebXRApp",
        );
        let meshes = 0,
          normals = 0;
        for (const visual of app.client.manipulation.renderer.ghosts.values())
          visual.traverse((part: any) => {
            if (part.isMesh) {
              meshes++;
              if (part.geometry.getAttribute("normal")) normals++;
            }
          });
        return meshes > 0 && meshes === normals;
      }),
    ).toBe(true);
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
          (c) => c.type === "manipulation_request" && c.action === "plan",
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.constructor.name === "WebXRApp",
        );
        return app.client.manipulation.interaction.dragging;
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.constructor.name === "WebXRApp",
        );
        const r = app.client.manipulation.renderer;
        return (
          !r.gripperMenu.visible &&
          !r.previewMenu.visible &&
          r.measuredHandle.object.visible
        );
      }),
    ).toBe(true);
    await setSelection(page, 0);
    expect(
      fixture.commands.some(
        (c) => c.action === "acquire" || c.action === "update",
      ),
    ).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return app.client.manipulation.interaction.snapshot().canPreview;
        }),
      )
      .toBe(true);
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
      .toMatch(/^fixture-plan-/);
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
      .toMatch(/^fixture-plan-/);
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

for (const location of ["settings", "arm"] as const) {
  test(`${location} manipulation speed slider captures a controller drag`, async ({
    page,
  }) => {
    const fixture = await bootstrap(page, "controller", { manipulation: true });
    try {
      await fixture.localized();
      await page.evaluate((location) => {
        const w = window as any;
        const app = w.xb.core.scene.children.find(
          (o: any) => o.constructor.name === "WebXRApp",
        );
        if (location === "settings") {
          if (!app.client.ui.menuOpen) app.client.ui.toggleMenu();
          app.mainMenu.settingsOpen = true;
        } else if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
        w.manipulationTestSlider =
          location === "settings"
            ? app.mainMenu.speedSlider
            : app.client.manipulation.renderer.speedSlider;
      }, location);
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find(
          (o: any) => o.constructor.name === "WebXRApp",
        );
        const hit = w.manipulationTestSlider.hit;
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
        const hit = w.manipulationTestSlider.hit;
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
      const endpointError=await page.evaluate(()=>{
        const w=window as any,app=w.xb.core.scene.children.find((o:any)=>o.constructor.name==="WebXRApp");
        const thumb=w.manipulationTestSlider.thumb;
        const position=thumb.getWorldPosition(thumb.position.clone());
        return app.interaction.beams.get(w.xb.core.input.rightController).tip.distanceTo(position);
      });
      expect(endpointError).toBeLessThan(0.001);
      await setSelection(page, 0);
    } finally {
      fixture.close();
    }
  });
}

test("arm Stop clears the target and one emergency control becomes Resume operation", async ({
  page,
}, info) => {
  const fixture = await bootstrap(page, "controller", { manipulation: true });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      app.client.setRobotSelected(true);
    });
    await aimHandle(page);
    await setSelection(page, 1);
    await page.evaluate(() => {
      (window as any).questDevice.controllers.right.position.y += 0.08;
    });
    await expect
      .poll(() => fixture.commands.some((c) => c.action === "plan"))
      .toBe(true);
    await setSelection(page, 0);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.manipulation.action("stop");
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return app.client.manipulation.interaction.target;
        }),
      )
      .toBeNull();
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.emergencyStop();
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return app.client.manipulation.renderer.panel.children.find(
            (c: any) => c.userData.manipulationAction === "resume",
          )?.text;
        }),
      )
      .toBe("Resume operation");
    await page.evaluate(() => {
      const w = window as any;
      w.questDevice.position.set(0.6, 1.35, -0.45);
      w.questDevice.quaternion.set(-0.122, 0.31, 0.04, 0.942);
      w.questDevice.quaternion.normalize();
      w.questDevice.controllers.right.position.set(1.5, 0.5, -0.3);
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: info.outputPath("manipulation-stopped.png"),
    });
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      app.client.manipulation.action("resume");
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          return app.client.manipulation.interaction.snapshot().stopped;
        }),
      )
      .toBe(false);
    expect(fixture.commands.filter((c) => c.action === "execute")).toHaveLength(
      0,
    );
  } finally {
    fixture.close();
  }
});

test("keeps the last valid preview visible while selected dragging outpaces the planner",async({page},info)=>{
  const fixture=await bootstrap(page,"controller",{manipulation:true,planDelayMs:650});
  try {
    await fixture.localized();
    await page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.constructor.name==="WebXRApp");
      if(app.client.ui.menuOpen)app.client.ui.toggleMenu(); app.client.setRobotSelected(true);
    });
    await aimHandle(page);await setSelection(page,1);
    await page.evaluate(()=>{const c=(window as any).questDevice.controllers.right;c.position.x+=0.1;});
    await expect.poll(()=>fixture.commands.filter(c=>c.action==="plan").length).toBeGreaterThan(0);
    await expect.poll(()=>page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.constructor.name==="WebXRApp");
      return app.client.manipulation.interaction.previewPlan?.plan_id??null;
    })).not.toBeNull();
    const first=fixture.commands.filter(c=>c.action==="plan").length;
    await page.evaluate(()=>{const c=(window as any).questDevice.controllers.right;c.position.x+=0.1;});
    await expect.poll(()=>fixture.commands.filter(c=>c.action==="plan").length).toBeGreaterThan(first);
    const facts=await page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.constructor.name==="WebXRApp");
      const {interaction,renderer}=app.client.manipulation;
      return {dragging:interaction.dragging,path:renderer.path.visible,preview:!!interaction.previewPlan,
        status:interaction.snapshot().activity,arm:[...renderer.previewMeshes.values()].some((o:any)=>o.visible)};
    });
    expect(facts).toEqual({dragging:true,path:true,preview:true,status:"Planning",arm:true});
    expect(fixture.commands.some(c=>c.action==="execute")).toBe(false);
    await page.screenshot({path:info.outputPath("continuous-arm-preview.png")});
    await setSelection(page,0);
  }finally{fixture.close();}
});
