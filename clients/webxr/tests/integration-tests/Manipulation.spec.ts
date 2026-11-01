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
          return app.client.manipulation.renderer.modelRenderer.ghosts.size;
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
        for (const visual of app.client.manipulation.renderer.modelRenderer.ghosts.values())
          visual.traverse((part: any) => {
            if (part.isMesh && !part.userData.armOutline) {
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
        status:interaction.snapshot().activity,arm:[...renderer.modelRenderer.previewMeshes.values()].some((o:any)=>o.visible)};
    });
    expect(facts).toEqual({dragging:true,path:true,preview:true,status:"Planning",arm:true});
    expect(fixture.commands.some(c=>c.action==="execute")).toBe(false);
    await page.screenshot({path:info.outputPath("continuous-arm-preview.png")});
    await setSelection(page,0);
  }finally{fixture.close();}
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
    // Finish the initial hover reveal before acquiring a time-sensitive following lease.
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.client.manipulation.renderer.gripperMenu.scale.x;
    })).toBeGreaterThan(0.999);
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
    expect(fixture.commands.some(c => c.action === "release"), JSON.stringify(fixture.commands.filter(c => c.action === "release" || c.action === "cancel"))).toBe(false);
    await expect.poll(() => fixture.commands.some(c => c.action === "update")).toBe(true);
    await setSelection(page, 0);
    await expect.poll(() => fixture.commands.some(c => c.action === "release")).toBe(true);
  } finally { await fixture.close(); }
});

for (const selected of [false, true]) {
  test(`IK wire failure retains the ${selected ? "planning" : "following"} grab and its valid mesh`, async ({ page }) => {
    const fixture = await bootstrap(page, "controller", { manipulation: true });
    try {
      await fixture.localized();
      await page.evaluate(selected => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
        app.client.setRobotSelected(selected);
      }, selected);
      await aimHandle(page); await setSelection(page, 1);
      await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.06; });
      const preview = () => page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
        return { joints: app.client.manipulation.interaction.previewJoints,
          dragging: app.client.manipulation.interaction.dragging, error: app.client.session.view().manipulationError,
          rejected: !!app.client.manipulation.interaction.rejection };
      });
      await expect.poll(async () => (await preview()).joints).not.toBeNull();
      await expect.poll(() => fixture.commands.some(c => c.action === (selected ? "plan" : "update"))).toBe(true);
      await page.waitForTimeout(500);
      const valid = (await preview()).joints;
      fixture.setIKFailure({ code: "ik_failed" });
      await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.09; });
      await expect.poll(async () => (await preview()).rejected).toBe(true);
      expect(await preview()).toMatchObject({ dragging: true, joints: valid, error: null });
      expect(fixture.commands.some(c => c.action === "release" || c.action === "cancel")).toBe(false);
      await page.screenshot({ path: test.info().outputPath(`ik-${selected ? "planning" : "following"}-retained.png`) });
      fixture.setIKFailure(null);
      await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y -= 0.04; });
      await expect.poll(async () => (await preview()).rejected).toBe(false);
      expect((await preview()).dragging).toBe(true);
      await setSelection(page, 0);
      if (selected) expect(fixture.commands.some(c => c.action === "execute")).toBe(false);
      else await expect.poll(() => fixture.commands.some(c => c.action === "release")).toBe(true);
    } finally { fixture.close(); }
  });
}

test("slider thumb remains above its track at every speed from oblique views", async ({ page }, info) => {
  const fixture = await bootstrap(page, "controller", { manipulation: true });
  try {
    await fixture.localized();
    const samples = await page.evaluate(async () => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const slider = app.client.manipulation.renderer.speedSlider;
      const parent = slider.parent, position = slider.position.clone(), rotation = slider.quaternion.clone(), scale = slider.scale.clone();
      const scene = new THREE.Scene(), renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setSize(600, 300); renderer.setClearColor(0x000000);
      const camera = new THREE.OrthographicCamera(-0.11, 0.11, 0.055, -0.055, 0.01, 5);
      const result: number[][] = [];
      scene.add(slider); slider.position.set(0, 0, 0); slider.quaternion.identity(); slider.scale.setScalar(1);
      document.body.appendChild(renderer.domElement);
      try {
        for (const angle of [0, 0.8]) for (const value of [0.05, 0.5, 1]) {
          slider.setValue(value);
          camera.position.set(Math.sin(angle), 0, Math.cos(angle)); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          const point = slider.thumb.localToWorld(new THREE.Vector3(slider.width * 0.025, 0, 0)).project(camera);
          const pixel = new Uint8Array(4), gl = renderer.getContext();
          gl.readPixels(Math.floor((point.x + 1) * 300), Math.floor((point.y + 1) * 150), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          result.push(Array.from(pixel));
        }
        return result;
      } finally {
        parent.add(slider); slider.position.copy(position); slider.quaternion.copy(rotation); slider.scale.copy(scale);
        renderer.dispose(); renderer.domElement.remove();
      }
    });
    for (const pixel of samples) for (const channel of pixel.slice(0, 3)) expect(channel).toBeGreaterThan(240);
    await page.screenshot({ path: info.outputPath("slider-layering.png") });
  } finally { fixture.close(); }
});

for (const mode of ["hand", "controller"] as const) {
  test(`arm hover preserves selection and smoothly reveals the idle mesh (${mode})`, async ({ page }, info) => {
    test.setTimeout(90000);
    const fixture = await bootstrap(page, mode, { manipulation: true });
    const point = async (away: boolean) => page.evaluate(away => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      const inputs = w.questDevice.primaryInputMode === "hand" ? w.questDevice.hands : w.questDevice.controllers;
      const p = app.client.manipulation.renderer.baseMarker.getWorldPosition(app.client.manipulation.renderer.baseMarker.position.clone());
      inputs.right.position.set(away ? -4 : p.x, away ? 2 : p.y, away ? 0 : p.z + 0.5);
      inputs.right.quaternion.set(0, 0, 0, 1); inputs.left.position.set(-5, 2, 0);
    }, away);
    const read = () => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const r = app.client.manipulation.renderer;
      const meshes = Array.from(r.modelRenderer.previewMeshes.values()) as any[];
      return { selected: app.client.isRobotSelected(), visible: meshes.map(m => m.visible),
        alpha: meshes.map(m => { let value = 0; m.traverse((part: any) => { if (part.isMesh && !part.userData.armOutline) value = part.material.uniforms.uOpacity.value; }); return value; }),
        measured: r.measuredHandle.object.visible, offset: app.client.manipulation.interaction.snapshot().targetOffset,
        hit: app.interaction.hit(w.xb.core.input.rightController)?.object.userData.manipulationLink };
    });
    try {
      await fixture.localized(); await point(true);
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
        app.client.setRobotSelected(true);
      });
      await expect.poll(async () => (await read()).visible.length).toBeGreaterThan(0);
      await expect.poll(async () => (await read()).visible.every(Boolean)).toBe(true);
      expect(await read()).toMatchObject({ selected: true, measured: true, offset: false });
      await expect.poll(async () => (await read()).alpha.every(a => a > 0.99)).toBe(true);
      // A held press begun in empty space must not activate a selection target on entry.
      await setSelection(page, 1); await point(false);
      await expect.poll(async () => (await read()).hit).toBe("base-marker");
      expect((await read()).selected).toBe(true);
      expect((await read()).alpha.every(a => a > 0.99)).toBe(true);
      await setSelection(page, 0);
      expect((await read()).selected).toBe(true);
      await point(true);
      await expect.poll(async () => (await read()).hit).toBeUndefined();
      expect((await read()).visible.every(Boolean)).toBe(true);
      expect((await read()).alpha.every(a => a > 0.99)).toBe(true);
      await point(false);
      await expect.poll(async () => (await read()).hit).toBe("base-marker");
      // A fresh press on the root sphere is an explicit toggle.
      await setSelection(page, 1); await setSelection(page, 0);
      await expect.poll(async () => (await read()).selected).toBe(false);
      await expect.poll(async () => (await read()).alpha.every(a => a > 0.95)).toBe(true);
      const before = (await read()).alpha[0];
      await point(true);
      const fadeFrames = await page.evaluate(async () => {
        const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
        const session = w.xb.core.renderer.xr.getSession(), values: number[] = [];
        for (let frame = 0; frame < 20; frame++) {
          await new Promise<void>(resolve => session.requestAnimationFrame(() => resolve()));
          const mesh = app.client.manipulation.renderer.modelRenderer.previewMeshes.values().next().value;
          mesh.traverse((part: any) => { if (part.isMesh && !part.userData.armOutline) values.push(part.material.uniforms.uOpacity.value); });
        }
        return values;
      });
      expect(fadeFrames.some(alpha => alpha > 0 && alpha < before - 0.001)).toBe(true);
      await expect.poll(async () => (await read()).visible.every(v => !v)).toBe(true);
      expect((await read()).measured).toBe(true);
      await page.screenshot({ path: info.outputPath(`arm-hover-${mode}.png`) });
    } finally { fixture.close(); }
  });
}

test("the selected near-EE action executes a checked draft and stays available under hover", async ({ page }, info) => {
  const fixture = await bootstrap(page, "controller", { manipulation: true });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.setRobotSelected(true);
    });
    await aimHandle(page); await setSelection(page, 1);
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.08; });
    await expect.poll(() => fixture.commands.some(c => c.action === "plan")).toBe(true);
    await setSelection(page, 0);
    await aimHandle(page);
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const r = app.client.manipulation.renderer, button = r.controlsView.buttons.get("gripper");
      return r.gripperMenu.visible && button.text === "Execute" && button.enabled;
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const button = app.client.manipulation.renderer.controlsView.buttons.get("gripper");
      const p = button.getWorldPosition(button.position.clone()), q = button.getWorldQuaternion(button.quaternion.clone());
      p.add(p.clone().set(0, 0, 0.5).applyQuaternion(q));
      w.questDevice.controllers.right.position.copy(p); w.questDevice.controllers.right.quaternion.copy(q);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.rightController)?.object.userData.manipulationAction;
    })).toBe("execute");
    expect(fixture.commands.some(c => c.action === "execute")).toBe(false);
    await page.screenshot({ path: info.outputPath("near-ee-execute.png") });
    await setSelection(page, 1); await setSelection(page, 0);
    await expect.poll(() => fixture.commands.filter(c => c.action === "execute").length).toBe(1);
    expect(fixture.commands.some(c => c.action === "gripper")).toBe(false);
  } finally { fixture.close(); }
});
