import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { bootstrap } from "./fixtures/Runtime";
import { setSelection } from "./fixtures/Input";
import { saveCaseProof } from "./fixtures/CaseProof";

test.afterEach(async ({}, info) => {
  await saveCaseProof(info, []);
});

async function aimHandle(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const app = (window as any).xb.core.scene.children.find(
      (o: any) => o.constructor.name === "WebXRApp",
    );
    return app.client.manipulation.interaction.snapshot().canManipulate;
  })).toBe(true);
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
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
            (o: any) => o.client?.manipulation,
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
            (o: any) => o.client?.manipulation,
          );
          return app.client.manipulation.renderer.modelRenderer.ghosts.size;
        }),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.client?.manipulation,
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
        (o: any) => o.client?.manipulation,
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
    expect(
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.client?.manipulation,
        );
        return app.client.manipulation.interaction.dragging;
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.client?.manipulation,
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
        (c) => c.type === "manipulation_request" && (c.action === "acquire" || c.action === "update"),
      ),
    ).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
          );
          return app.client.manipulation.interaction.snapshot().canPreview;
        }),
      )
      .toBe(true);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
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
            (o: any) => o.client?.manipulation,
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
        (o: any) => o.client?.manipulation,
      );
      app.client.manipulation.action("execute");
    });
    await expect
      .poll(() => fixture.commands.find((c) => c.action === "execute")?.plan_id)
      .toMatch(/^fixture-plan-/);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      );
      app.client.setRobotSelected(false);
    });
    await aimHandle(page);
    await setSelection(page, 1);
    await expect
      .poll(() => fixture.commands.some((c) => c.type === "manipulation_request" && c.action === "acquire"))
      .toBe(true);
    await page.evaluate(() => {
      (window as any).questDevice.controllers.right.position.x += 0.08;
    });
    await expect
      .poll(() => fixture.commands.some((c) => c.type === "manipulation_request" && c.action === "update"))
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
          (o: any) => o.client?.manipulation,
        );
        if (location === "settings") {
          if (!app.client.ui.menuOpen) app.client.ui.toggleMenu();
          app.mainMenu.sensorsOpen = true;
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
          (o: any) => o.client?.manipulation,
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
              (o: any) => o.client?.manipulation,
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
          (o: any) => o.client?.manipulation,
        );
        return app.client.manipulation.interaction.speedScale;
      });
      await page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find(
          (o: any) => o.client?.manipulation,
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
              (o: any) => o.client?.manipulation,
            ).client.manipulation.interaction.speedScale;
          }),
        )
        .toBeGreaterThan(before + 0.15);
      const endpointError=await page.evaluate(()=>{
        const w=window as any,app=w.xb.core.scene.children.find((o:any)=>o.client?.manipulation);
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
        (o: any) => o.client?.manipulation,
      );
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      app.client.setRobotSelected(true);
    });
    await aimHandle(page);
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
      return app.client.manipulation.interaction.dragging;
    })).toBe(true);
    await page.evaluate(() => {
      (window as any).questDevice.controllers.right.position.y += 0.08;
    });
    await expect
      .poll(() => fixture.commands.some((c) => c.action === "evaluate"))
      .toBe(true);
    await setSelection(page, 0);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      );
      app.client.manipulation.action("stop");
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
          );
          return app.client.manipulation.interaction.target;
        }),
      )
      .toBeNull();
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      );
      app.client.emergencyStop();
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
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
        (o: any) => o.client?.manipulation,
      );
      app.client.manipulation.action("resume");
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
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

test("keeps the last valid preview visible while selected dragging outpaces IK",async({page},info)=>{
  const fixture=await bootstrap(page,"controller",{manipulation:true,evaluationDelayMs:200});
  try {
    await fixture.localized();
    await page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      if(app.client.ui.menuOpen)app.client.ui.toggleMenu(); app.client.setRobotSelected(true);
    });
    await aimHandle(page); await setSelection(page,1);
    await page.evaluate(()=>{(window as any).questDevice.controllers.right.position.x+=.1;});
    await expect.poll(()=>page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      return !!app.client.manipulation.interaction.previewJoints;
    })).toBe(true);
    const first=fixture.commands.filter(c=>c.action==="evaluate").length;
    await page.evaluate(()=>{(window as any).questDevice.controllers.right.position.x+=.1;});
    await expect.poll(()=>fixture.commands.filter(c=>c.action==="evaluate").length).toBeGreaterThan(first);
    const facts=await page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      const {interaction,renderer}=app.client.manipulation;
      return {dragging:interaction.dragging,path:renderer.path.visible,preview:!!interaction.previewJoints,
        arm:[...renderer.modelRenderer.previewMeshes.values()].some((o:any)=>o.visible)};
    });
    expect(facts).toEqual({dragging:true,path:true,preview:true,arm:true});
    expect(fixture.commands.some(c=>c.action==="plan"||c.action==="execute")).toBe(false);
    await page.screenshot({path:info.outputPath("continuous-arm-preview.png")});
    await setSelection(page,0);
    await expect.poll(()=>fixture.commands.some(c=>c.action==="plan")).toBe(true);
  }finally{fixture.close();}
});

test("hand tracking keeps the gripper usable by the other hand during following", async ({ page }) => {
  test.setTimeout(90000);
  const fixture = await bootstrap(page, "hand", { manipulation: true });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      const p = app.client.manipulation.renderer.handle.object.getWorldPosition(app.client.manipulation.renderer.handle.object.position.clone());
      w.questDevice.hands.right.position.set(p.x, p.y, p.z + 0.7);
      w.questDevice.hands.right.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.interaction.hit(w.xb.core.input.rightController)?.object.name;
    })).toBe("EndEffectorHandleCollider");
    // Finish the initial hover reveal before acquiring a time-sensitive following lease.
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.client.manipulation.renderer.gripperMenu.scale.x;
    })).toBeGreaterThan(0.999);
    await setSelection(page, 1);
    await expect.poll(() => fixture.commands.some(c => c.type === "manipulation_request" && c.action === "acquire")).toBe(true);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      w.questDevice.hands.right.position.y += 0.05;
    });
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.client.manipulation.renderer.gripperMenu.scale.x;
    })).toBeGreaterThan(0.999);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const button = app.client.manipulation.renderer.gripperMenu.children[0];
      const p = button.getWorldPosition(button.position.clone()), q = button.getWorldQuaternion(button.quaternion.clone());
      const normal = p.clone().set(0, 0, 1).applyQuaternion(q); p.addScaledVector(normal, 0.5);
      w.questDevice.hands.left.position.set(p.x, p.y, p.z);
      w.questDevice.hands.left.quaternion.set(q.x, q.y, q.z, q.w);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
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
        const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
        return { holding: !!app.inputController.manipulationHold, fresh: app.client.manipulation.interaction.feedbackFresh,
          selected: app.client.isRobotSelected(), dragging: app.client.manipulation.interaction.dragging,
          following: app.client.manipulation.interaction.following, status: app.client.manipulation.interaction.status,
          hit: app.interaction.hit(w.xb.core.input.leftController)?.object.userData.manipulationAction };
      }),
    })).toContain('"count":1');
    expect(fixture.commands.some(c => c.action === "release"), JSON.stringify(fixture.commands.filter(c => c.action === "release" || c.action === "cancel"))).toBe(false);
    await expect.poll(() => fixture.commands.some(c => c.type === "manipulation_request" && c.action === "update")).toBe(true);
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
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        app.client.setRobotSelected(selected);
      }, selected);
      await aimHandle(page); await setSelection(page, 1);
      await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.06; });
      const preview = () => page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        return { joints: app.client.manipulation.interaction.previewJoints,
          dragging: app.client.manipulation.interaction.dragging, error: app.client.session.view().manipulationError,
          rejected: !!app.client.manipulation.interaction.rejection,
          activity: app.client.manipulation.interaction.snapshot().activity,
          feedbackFresh: app.client.manipulation.interaction.feedbackFresh };
      });
      await expect.poll(async () => (await preview()).joints).not.toBeNull();
      await expect.poll(() => fixture.commands.some(c => c.action === (selected ? "evaluate" : "update"))).toBe(true);
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
      expect({ ...await preview(), recentCommands: fixture.commands.slice(-4) }).toMatchObject({ dragging: true });
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
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
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
  test(`arm hover preserves selection with outline-only feedback and a fading selected fill (${mode})`, async ({ page }, info) => {
    test.setTimeout(90000);
    const fixture = await bootstrap(page, mode, { manipulation: true });
    const point = async (away: boolean) => page.evaluate(away => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      const inputs = w.questDevice.primaryInputMode === "hand" ? w.questDevice.hands : w.questDevice.controllers;
      const p = app.client.manipulation.renderer.baseMarker.getWorldPosition(app.client.manipulation.renderer.baseMarker.position.clone());
      inputs.right.position.set(away ? -4 : p.x, away ? 2 : p.y, away ? 0 : p.z + 0.5);
      inputs.right.quaternion.set(0, 0, 0, 1); inputs.left.position.set(-5, 2, 0);
    }, away);
    const read = () => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
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
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
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
      await expect.poll(async () => (await read()).alpha.every(a => a > 1.09)).toBe(true);
      await setSelection(page, 0);
      expect((await read()).selected).toBe(true);
      await point(true);
      await expect.poll(async () => (await read()).hit).toBeUndefined();
      expect((await read()).visible.every(Boolean)).toBe(true);
      await expect.poll(async () => (await read()).alpha.every(a => a > 0.99)).toBe(true);
      await point(false);
      await expect.poll(async () => (await read()).hit).toBe("base-marker");
      // A fresh press on the root sphere is an explicit toggle.
      await setSelection(page, 1); await setSelection(page, 0);
      await expect.poll(async () => (await read()).selected).toBe(false);
      await expect.poll(async () => (await read()).alpha.every(a => a < 0.01)).toBe(true);
      await point(true);
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        app.client.setRobotSelected(true);
      });
      await expect.poll(async () => (await read()).alpha.every(a => a > 0.99)).toBe(true);
      const before = (await read()).alpha[0];
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        app.client.setRobotSelected(false);
      });
      const fadeFrames = await page.evaluate(async () => {
        const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
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
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.setRobotSelected(true);
    });
    await aimHandle(page); await setSelection(page, 1);
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.08; });
    await expect.poll(() => fixture.commands.some(c => c.action === "evaluate")).toBe(true);
    await setSelection(page, 0);
    await aimHandle(page);
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const r = app.client.manipulation.renderer, button = r.controlsView.buttons.get("execute");
      return r.previewMenu.visible && button.text === "Execute" && button.enabled;
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const button = app.client.manipulation.renderer.controlsView.buttons.get("execute");
      const p = button.getWorldPosition(button.position.clone()), q = button.getWorldQuaternion(button.quaternion.clone());
      p.add(p.clone().set(0, 0, 0.5).applyQuaternion(q));
      w.questDevice.controllers.right.position.copy(p); w.questDevice.controllers.right.quaternion.copy(q);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.interaction.hit(w.xb.core.input.rightController)?.object.userData.manipulationAction;
    })).toBe("execute");
    expect(fixture.commands.some(c => c.action === "execute")).toBe(false);
    await page.screenshot({ path: info.outputPath("near-ee-execute.png") });
    await setSelection(page, 1); await setSelection(page, 0);
    await expect.poll(() => fixture.commands.filter(c => c.action === "execute").length).toBe(1);
    expect(fixture.commands.some(c => c.action === "gripper")).toBe(false);
  } finally { fixture.close(); }
});

test("debug draws base, both EE frames and measured joint angles", async ({page}, info) => {
  const fixture = await bootstrap(page, "controller", {manipulation: true});
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.ui.debugEnabled = true;
    });
    const read = () => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return Array.from(app.client.manipulation.renderer.debugNodes.entries()).map(([name, value]: any) => ({name, visible:value.node.visible, label:value.label.text}));
    });
    await expect.poll(async () => (await read()).filter(x => x.visible).length).toBeGreaterThanOrEqual(9);
    const rows = await read();
    for (const name of ["base", "current-ee", "target-ee"]) expect(rows.some(x => x.name === name && x.visible)).toBe(true);
    expect(rows.filter(x => x.name.startsWith("yam_joint") && x.label.endsWith("°"))).toHaveLength(6);
    for (const name of ["current-ee","target-ee"]) expect(rows.find(x=>x.name===name)?.label).toMatch(/R .*° P .*° Y .*°/);
    await page.screenshot({path:info.outputPath("arm-debug-frames.png")});
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.ui.debugEnabled = false;
    });
    await expect.poll(async () => (await read()).every(x => !x.visible)).toBe(true);
  } finally { fixture.close(); }
});

test("arm base frame moves and scales independently and Pin restores its anchor", async ({ page }, info) => {
  const fixture = await bootstrap(page, "controller", { manipulation: true });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      app.client.setRobotSelected(true);
    });
    const aim = async (zone: string) => page.evaluate(zone => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const r = app.client.manipulation.renderer;
      const target = zone === "pin" ? r.controlsView.buttons.get("pin") : r.controlsView.frame.object.children.find((c: any) => c.userData.panelHandle === zone);
      const p = target.getWorldPosition(target.position.clone()), q = target.getWorldQuaternion(target.quaternion.clone());
      p.add(p.clone().set(0, 0, .5).applyQuaternion(q));
      w.questDevice.controllers.right.position.copy(p); w.questDevice.controllers.right.quaternion.copy(q);
    }, zone);
    const panel = () => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation), r = app.client.manipulation.renderer;
      return { position: r.panel.getWorldPosition(r.panel.position.clone()).toArray(), scale: r.panel.scale.x, anchored: r.panel.parent === r.baseMarker, badgePosition: r.controlsView.baseLabel.getWorldPosition(r.panel.position.clone()).toArray(), badgeScale: r.controlsView.baseLabel.getWorldScale(r.panel.position.clone()).toArray(), glyphs: [r.controlsView.baseLabel.tagTitle,r.controlsView.baseLabel.tagStatus,r.controlsView.baseLabel.tagMessage].map(t => ({position:t.getWorldPosition(r.panel.position.clone()).toArray(), scale:t.getWorldScale(r.panel.position.clone()).toArray()})) };
    });
    await aim("bar");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.interaction.hit(w.xb.core.input.rightController)?.object.userData.panelHandle;
    })).toBe("bar");
    const before = await panel();
    await setSelection(page, 1);
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.x += .12; });
    await expect.poll(async () => (await panel()).position[0] - before.position[0]).toBeGreaterThan(.08);
    await setSelection(page, 0);
    expect((await panel()).anchored).toBe(false);
    expect((await panel()).badgePosition).toEqual(before.badgePosition);
    expect((await panel()).badgeScale).toEqual(before.badgeScale);
    expect((await panel()).glyphs).toEqual(before.glyphs);
    await aim("right"); await setSelection(page, 1);
    const originalScale = (await panel()).scale;
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.x += .08; });
    await expect.poll(async () => (await panel()).scale).toBeGreaterThan(originalScale * 1.1);
    await setSelection(page, 0);
    await aim("right"); await setSelection(page, 1);
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.x -= .8; });
    await expect.poll(async () => (await panel()).scale).toBeCloseTo(.65625);
    await setSelection(page, 0);
    expect((await panel()).badgeScale).toEqual(before.badgeScale);
    expect((await panel()).glyphs).toEqual(before.glyphs);
    await aim("pin"); await setSelection(page, 1); await setSelection(page, 0);
    await expect.poll(async () => (await panel()).anchored).toBe(true);
    expect((await panel()).scale).toBeCloseTo(.875);
    expect(fixture.commands.some(c => ["acquire", "update", "execute", "reset_joints", "gripper"].includes(c.action))).toBe(false);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const r = app.client.manipulation.renderer;
      r.detachPanel(); r.panel.position.set(0, 1.4, -.6); r.panel.quaternion.identity();
    });
    await page.screenshot({ path: info.outputPath("arm-base-frame.png") });
  } finally { fixture.close(); }
});

test("Pin glyph remains visible above its button at minimum panel size", async ({page}) => {
  const fixture = await bootstrap(page, "controller", {manipulation: true});
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.setRobotSelected(true);
      const r = app.client.manipulation.renderer;
      r.detachPanel(); r.panel.scale.setScalar(.65625);
    });
    const difference = await page.evaluate(async () => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      await new Promise<void>(resolve => (window as any).xb.core.renderer.xr.getSession().requestAnimationFrame(() => resolve()));
      const r = app.client.manipulation.renderer, panel = r.panel, icon = r.controlsView.frame.pinLines;
      const parent = panel.parent, position = panel.position.clone(), rotation = panel.quaternion.clone();
      const scene = new THREE.Scene(), renderer = new THREE.WebGLRenderer({antialias: false});
      renderer.setSize(200, 200); renderer.setClearColor(0x202022);
      scene.add(panel); panel.position.set(0, 0, 0); panel.quaternion.identity(); panel.updateMatrixWorld(true);
      const point = icon.getWorldPosition(new THREE.Vector3());
      const camera = new THREE.OrthographicCamera(-.012, .012, .012, -.012, .01, 3);
      camera.position.set(point.x, point.y, 1); camera.lookAt(point.x, point.y, 0); camera.updateMatrixWorld(true);
      const whites = () => {
        renderer.render(scene, camera);
        const pixels = new Uint8Array(200*200*4), gl = renderer.getContext(); gl.readPixels(0, 0, 200, 200, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 245 && pixels[i+1] > 245 && pixels[i+2] > 245) count++;
        return count;
      };
      try { const visible = whites(); icon.visible = false; return visible - whites(); }
      finally { icon.visible = true; parent.add(panel); panel.position.copy(position); panel.quaternion.copy(rotation); renderer.dispose(); }
    });
    expect(difference).toBeGreaterThan(25);
  } finally { fixture.close(); }
});

for (const selected of [false, true]) test(`production model moves through intermediate frames for ${selected ? "planning" : "measured"} updates`, async ({page}) => {
  const fixture = await bootstrap(page, "controller", {manipulation: true, planJointDelta: .6, planDelayMs: 300, armIntervalMs: 250});
  try {
    await fixture.localized();
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.client.manipulation.renderer.modelRenderer.previewMeshes.has("link2");
    })).toBe(true);
    await page.evaluate(selected => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.setRobotSelected(selected);
      const r = app.client.manipulation.renderer, mesh = r.modelRenderer.previewMeshes.get("link2");
      w.motionBaseline = mesh.quaternion.clone();
      // Software rendering can skip the entire 50 ms interpolation horizon.
      // Sample the production renderer on a deterministic 90 Hz animation clock.
      const apply = r.apply.bind(r);
      let animationTime = performance.now() / 1000;
      r.apply = (input: any) => apply({...input, now: animationTime += 1 / 90});
      if (selected) {
        const interaction = app.client.manipulation.interaction, current = app.client.session.view().manipulation.observations.manipulator.pose;
        interaction.begin(); interaction.aim({...current, position: [current.position[0],current.position[1],current.position[2]+.06]});
      }
    }, selected);
    if (selected) {
      await expect.poll(() => page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        return app.client.session.collaboration.snapshot("manipulation", "manipulator").ownsAuthority;
      })).toBe(true);
      await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        app.client.manipulation.interaction.end();
      });
    }
    if (!selected) {
      const value = await page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
        return app.client.session.view().manipulation.observations.manipulator.joints.yam_joint2;
      });
      fixture.setArmJoint("yam_joint2", value + .6, false);
    }
    const samples = await page.evaluate(async () => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const session = w.xb.core.renderer.xr.getSession(), frames: {angle: number; time: number}[] = [];
      for (let i = 0; i < 45; i++) {
        await new Promise<void>(resolve => session.requestAnimationFrame(() => resolve()));
        const mesh = app.client.manipulation.renderer.modelRenderer.previewMeshes.get("link2");
        frames.push({angle: mesh.quaternion.angleTo(w.motionBaseline), time: performance.now()});
      }
      return frames;
    });
    const intermediate = samples.filter(s => s.angle > .005 && s.angle < .59);
    console.log(JSON.stringify({selected, intermediate: intermediate.length, averageFrameMs: (samples.at(-1)!.time-samples[0].time)/44}));
    // Deliver changed measurements on the regular 250 ms packet cadence, avoiding an
    // artificial near-zero interval from an out-of-band fixture update.
    expect(intermediate.length).toBeGreaterThanOrEqual(1);
    for(let i=1;i<samples.length;i++) expect(samples[i].angle).toBeGreaterThanOrEqual(samples[i-1].angle-.001);
    expect(samples.at(-1)!.angle).toBeCloseTo(.6, 2);
  } finally { fixture.close(); }
});


test("compact controls share a row and recalibration starts the localization flow", async ({page}, info) => {
  const fixture = await bootstrap(page,"controller",{manipulation:true});
  try {
    await fixture.localized();
    const result = await page.evaluate(() => {
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      const controls=app.client.manipulation.renderer.controlsView;
      const stop=controls.buttons.get("stop"),reset=controls.buttons.get("reset"),pin=controls.buttons.get("pin"),scan=controls.buttons.get("recalibrate");
      return {stopY:stop.position.y,resetY:reset.position.y,pinY:pin.position.y,scanY:scan.position.y,
        stopHeight:stop.rangeY,resetHeight:reset.rangeY,title:controls.title.text,scanEnabled:scan.enabled};
    });
    expect(result.stopY).toBe(result.resetY);expect(result.pinY).toBe(result.scanY);
    expect(result.stopHeight).toBe(result.resetHeight);expect(result.title.length).toBeGreaterThan(0);expect(result.scanEnabled).toBe(true);
    await page.screenshot({path:info.outputPath("compact-controls.png")});
    await page.evaluate(()=>{
      const w=window as any,app=w.xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      const button=app.client.manipulation.renderer.controlsView.buttons.get("recalibrate");
      const p=button.getWorldPosition(button.position.clone()),q=button.getWorldQuaternion(button.quaternion.clone());
      p.addScaledVector(p.clone().set(0,0,1).applyQuaternion(q),.3);
      w.questDevice.controllers.right.position.copy(p); w.questDevice.controllers.right.quaternion.copy(q);
    });
    await expect.poll(()=>page.evaluate(()=>{
      const w=window as any,app=w.xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      return app.interaction.hit(w.xb.core.input.rightController)?.object.userData.manipulationAction;
    })).toBe("recalibrate");
    await setSelection(page,1); await setSelection(page,0);
    const after=await page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      return {step:app.client.ui.wizardStep,completed:app.client.ui.setupCompleted};
    });
    expect(after).toEqual({step:"localization",completed:false});
    expect(fixture.commands.some(c=>["execute","reset_joints","gripper"].includes(c.action))).toBe(false);
  } finally {fixture.close();}
});

for(const selected of [false,true]) test(`feedback loss preserves the ${selected ? "planning" : "following"} grab and model for one second`,async({page},info)=> {
  test.setTimeout(60000);
  const fixture=await bootstrap(page,"controller",{manipulation:true,armIntervalMs:33});
  try {
    await fixture.localized();
    await page.evaluate(selected=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      app.client.setRobotSelected(selected);
    },selected);
    await aimHandle(page); await setSelection(page,1);
    await page.evaluate(()=>{(window as any).questDevice.controllers.right.position.y+=.06;});
    const read=()=>page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      const {interaction,renderer}=app.client.manipulation;
      return {held:interaction.dragging,target:interaction.target,retained:interaction.retainingFeedback,
        visible:renderer.handle.object.visible&&renderer.measuredHandle.object.visible,
        model:[...renderer.modelRenderer.previewMeshes.values()].map((o:any)=>[o.visible,...o.position.toArray(),...o.quaternion.toArray()]),
        current:renderer.measuredHandle.object.position.toArray()};
    });
    await expect.poll(async()=>!!(await read()).target).toBe(true);
    fixture.pauseArmFeedback(true);
    await expect.poll(async()=>(await read()).retained).toBe(true);
    const held=await read(), count=fixture.commands.length;
    await page.evaluate(()=>{(window as any).questDevice.controllers.right.position.x+=.06;});
    await page.waitForTimeout(250);
    const moved=await read();
    expect(moved).toMatchObject({held:true,visible:true,retained:true,model:held.model,current:held.current});
    expect(moved.target).not.toEqual(held.target);
    expect(fixture.commands.slice(count).some(c=>c.type === "manipulation_request" && ["update","evaluate","plan","execute","acquire"].includes(c.action))).toBe(false);
    fixture.pauseArmFeedback(false);
    await expect.poll(async()=>(await read()).retained).toBe(false);
    expect((await read()).held).toBe(true);
    if(!selected) await expect.poll(()=>fixture.commands.filter(c=>c.type === "manipulation_request" && c.action==="acquire").length).toBe(2);
    fixture.pauseArmFeedback(true);
    await expect.poll(async()=>(await read()).retained).toBe(true);
    await page.waitForTimeout(1100);
    await expect.poll(async()=>(await read()).held).toBe(false);
    expect((await read()).visible).toBe(false);
    await page.screenshot({path:info.outputPath(`feedback-loss-${selected ? "planning" : "following"}.png`)});
    await setSelection(page,0);
  } finally {fixture.close();}
});

for(const selected of [false,true]) test(`socket reconnect retains the ${selected ? "planning" : "following"} grab without automatic motor Resume`,async({page})=> {
  const fixture=await bootstrap(page,"controller",{manipulation:true,armReference:"stable-arm-reference"});
  try {
    await fixture.localized();
    await page.evaluate(selected=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      app.client.setRobotSelected(selected);
    },selected);
    await aimHandle(page); await setSelection(page,1);
    await page.evaluate(()=>{(window as any).questDevice.controllers.right.position.y+=.06;});
    await expect.poll(()=>fixture.commands.some(c=>c.action===(selected?"evaluate":"update"))).toBe(true);
    const read=()=>page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      const m=app.client.manipulation;
      return {connection:app.client.session.view().connection,held:m.interaction.dragging,
        stopped:m.interaction.snapshot().stopped,target:m.interaction.target,
        selected:app.client.isRobotSelected(),visible:m.renderer.handle.object.visible};
    });
    fixture.dropArmConnection();
    await expect.poll(async()=>(await read()).connection).not.toBe("ready");
    expect(await read()).toMatchObject({held:true,visible:true,selected});
    await page.evaluate(()=>{(window as any).questDevice.controllers.right.position.x+=.04;});
    await expect.poll(async()=>(await read()).connection).toBe("ready");
    await expect.poll(async()=>(await read()).stopped).toBe(true);
    expect(await read()).toMatchObject({held:true,visible:true,selected});
    expect(fixture.commands.some(c=>c.action==="resume")).toBe(false);
    await page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      app.client.manipulation.action("resume");
    });
    await expect.poll(async()=>(await read()).stopped).toBe(false);
    expect((await read()).held).toBe(true);
    if(!selected) await expect.poll(()=>fixture.commands.filter(c=>c.type === "manipulation_request" && c.action==="acquire").length).toBe(2);
    await setSelection(page,0);
  } finally {fixture.close();}
});

test("a sustained selected controller grab animates live IK through delayed snapshots and failure recovery", async ({ page }, info) => {
  test.setTimeout(120000);
  const fixture = await bootstrap(page, "controller", { manipulation: true, independentIK: true,
    interactionDelayMs: 120, evaluationDelayMs: 100, evaluationTargetScale: 3 });
  const read = () => page.evaluate(() => {
    const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
    const interaction = app.client.manipulation.interaction;
    const observed = app.client.session.view().manipulation.observations.manipulator;
    const expectedJoint = interaction.target
      ? observed.joints.yam_joint2 + 0.2 + 3 * (interaction.target.position[2] - observed.pose.position[2])
      : null;
    return { held: interaction.dragging, failed: interaction.rejection !== null, plan: interaction.plan?.plan_id,
      readyToRelease: interaction.dragging && interaction.snapshot().hasDraft && expectedJoint !== null &&
        Math.abs((interaction.previewJoints?.yam_joint2 ?? Infinity) - expectedJoint) < 0.01 };
  });
  const sweep = () => page.evaluate(async () => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
    const manipulation = app.client.manipulation, renderer = manipulation.renderer;
    const controller = w.questDevice.controllers.right, initialY = controller.position.y;
    const baseline = renderer.modelRenderer.previewMeshes.get("link2").quaternion.clone();
    const xr = w.xb.core.renderer.xr.getSession(), started = performance.now();
    const samples: { angle: number; joint: number | null; held: boolean; visible: boolean }[] = [];
    for (let frame = 0; frame < 48 || performance.now() - started < 2400; frame++) {
      await new Promise<void>(resolve => xr.requestAnimationFrame(() => resolve()));
      controller.position.y = initialY + (frame + 1) * 0.0015;
      const mesh = renderer.modelRenderer.previewMeshes.get("link2");
      samples.push({ angle: mesh.quaternion.angleTo(baseline), visible: mesh.visible,
        joint: manipulation.interaction.previewJoints?.yam_joint2 ?? null,
        held: manipulation.interaction.dragging });
    }
    return { samples, elapsedMs: performance.now() - started };
  });
  try {
    await fixture.localized();
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.client.manipulation.renderer.modelRenderer.previewMeshes.has("link2");
    })).toBe(true);
    await page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.setRobotSelected(true);
    });
    // Establish an actual reviewed endpoint before testing failure recovery during a later grab.
    await aimHandle(page); await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.client.session.collaboration.snapshot("manipulation", "manipulator").ownsAuthority;
    })).toBe(true);
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.04; });
    await expect.poll(async () => (await read()).readyToRelease).toBe(true);
    await setSelection(page, 0);
    await expect.poll(async () => (await read()).plan).toMatch(/^fixture-plan-/);
    const reviewedPlans = fixture.commands.filter(c => c.type === "manipulation_request" && c.action === "plan").length;
    await aimHandle(page); await setSelection(page, 1);
    await expect.poll(async () => (await read()).held).toBe(true);
    const first = await sweep();
    expect(first.elapsedMs).toBeGreaterThanOrEqual(2400);
    expect(first.samples.every(s => s.held && s.visible)).toBe(true);
    expect(new Set(first.samples.filter(s => s.joint !== null).map(s => s.joint!.toFixed(4))).size).toBeGreaterThan(6);
    expect(new Set(first.samples.map(s => s.angle.toFixed(4))).size).toBeGreaterThan(10);
    expect(Math.max(...first.samples.map(s => s.angle))).toBeGreaterThan(0.05);
    await page.screenshot({ path: info.outputPath("sustained-live-ik-before-release.png") });
    fixture.setIKFailure({ code: "ik_failed" });
    await page.evaluate(() => { (window as any).questDevice.controllers.right.position.y += 0.08; });
    await expect.poll(async () => (await read()).failed).toBe(true);
    expect((await read()).held).toBe(true);
    fixture.setIKFailure(null);
    const recovered = await sweep();
    expect(recovered.samples.every(s => s.held && s.visible)).toBe(true);
    expect(new Set(recovered.samples.filter(s => s.joint !== null).map(s => s.joint!.toFixed(4))).size).toBeGreaterThan(6);
    expect(new Set(recovered.samples.map(s => s.angle.toFixed(4))).size).toBeGreaterThan(10);
    expect(Math.max(...recovered.samples.map(s => s.angle))).toBeGreaterThan(0.05);
    expect(fixture.commands.some(c => c.type === "manipulation_request" && c.action === "execute")).toBe(false);
    expect(fixture.commands.filter(c => c.type === "manipulation_request" && c.action === "plan")).toHaveLength(reviewedPlans);
    expect((await read()).held).toBe(true);
    const sampleFile = info.outputPath("held-grab-mesh-samples.json");
    await writeFile(sampleFile, JSON.stringify({ first, recovered }));
    await info.attach("held-grab-mesh-samples", { path: sampleFile, contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("sustained-live-ik-recovered-before-release.png") });
    await setSelection(page, 0);
  } finally {
    const commandFile = info.outputPath("held-grab-control-commands.json");
    await writeFile(commandFile, JSON.stringify(fixture.commands));
    await info.attach("held-grab-control-commands", { path: commandFile, contentType: "application/json" });
    fixture.close();
  }
});

test("keeps advisory IK progressing for a minute through delayed plans, regrabs and recovery", async ({ page }, info) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const fixture = await bootstrap(page, "controller", {
    manipulation: true, independentIK: true, evaluationDelayMs: 180,
    planDelayMs: 1800, interactionDelayMs: 80, evaluationTargetScale: 3,
  });
  try {
    await fixture.localized();
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
      app.client.setRobotSelected(true);
      if (app.client.ui.menuOpen) app.client.ui.toggleMenu();
      const interaction = app.client.manipulation.interaction;
      const initial = app.client.session.view().manipulation.observations.manipulator.pose;
      const probe = w.advisorySoak = {
        completions: 0, feasible: 0, failures: 0, regrabs: 0, frames: 0,
        maxPending: 0, maxEvaluations: 0, maxPlans: 0, failedRegrabs: 0,
        lastBeginAt: 0, running: true,
      };
      probe.unsubscribe = app.client.session.subscribeOutbound((message: any) => {
        if (message.type !== "manipulation_result" || message.action !== "evaluate") return;
        probe.completions++;
        if (message.status === "feasible") probe.feasible++; else probe.failures++;
      });
      const regrab = () => {
        if (!probe.running) return;
        if (interaction.begin()) { probe.regrabs++; probe.lastBeginAt = performance.now(); }
        else probe.failedRegrabs++;
      };
      regrab();
      probe.timer = setInterval(() => {
        probe.frames++;
        const phase = probe.frames % 50;
        // Leave enough time for a full plan to start, then grab while it is pending.
        if (phase === 10) interaction.end();
        if (phase === 16) regrab();
        // Also exercise release/regrab without an intervening animation frame.
        if (phase === 35) { interaction.end(); regrab(); }
        if (interaction.dragging) {
          interaction.aim({ position: [initial.position[0] + 0.015 * Math.sin(probe.frames / 7),
            initial.position[1], initial.position[2] + 0.06 + 0.02 * Math.cos(probe.frames / 9)],
            orientation: [...initial.orientation] });
          if (probe.frames % 8 === 0) interaction.setSpeedScale(probe.frames % 16 === 0 ? 0.35 : 0.7);
        }
        const pending = [...interaction.pending.values()] as any[];
        probe.maxPending = Math.max(probe.maxPending, pending.length);
        probe.maxEvaluations = Math.max(probe.maxEvaluations, pending.filter(p => p.action === "evaluate").length);
        probe.maxPlans = Math.max(probe.maxPlans, pending.filter(p => p.action === "plan").length);
      }, 80);
    });
    const samples: any[] = [];
    for (let window = 0; window < 12; window++) {
      fixture.setIKFailure(window % 4 === 1 ? { code: "ik_failed" } : null);
      const previous = samples.at(-1);
      await page.waitForTimeout(5000);
      const sample = await page.evaluate(() => {
        const w = window as any, probe = w.advisorySoak;
        const app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
        const graphics = w.xb.core.renderer.info;
        return { completions: probe.completions, feasible: probe.feasible, failures: probe.failures,
          regrabs: probe.regrabs, maxPending: probe.maxPending,
          maxEvaluations: probe.maxEvaluations, maxPlans: probe.maxPlans,
          preview: !!app.client.manipulation.interaction.previewJoints,
          geometries: graphics.memory.geometries, textures: graphics.memory.textures,
          programs: graphics.programs.length };
      });
      samples.push(sample);
      // Every five-second window must make progress, even during IK failures.
      expect(sample.completions - (previous?.completions ?? 0)).toBeGreaterThan(2);
      expect(sample.preview).toBe(true);
      expect(sample.maxEvaluations).toBeLessThanOrEqual(1);
      expect(sample.maxPlans).toBeLessThanOrEqual(1);
      expect(sample.maxPending).toBeLessThanOrEqual(4);
      if (window % 4 === 1) expect(sample.failures - (previous?.failures ?? 0)).toBeGreaterThan(0);
      else expect(sample.feasible - (previous?.feasible ?? 0)).toBeGreaterThan(0);
      if (window >= 3) {
        // The first three windows warm text atlases and both success/failure paths.
        expect(sample.geometries).toBeLessThanOrEqual(samples[2].geometries + 2);
        expect(sample.textures).toBeLessThanOrEqual(samples[2].textures + 1);
        expect(sample.programs).toBeLessThanOrEqual(samples[2].programs + 2);
      }
    }
    expect(samples.at(-1).regrabs).toBeGreaterThanOrEqual(12);
    expect(fixture.commands.some(c => c.type === "manipulation_request" && c.action === "plan")).toBe(true);
    expect(fixture.commands.some(c => c.type === "manipulation_request" && c.action === "execute")).toBe(false);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath("advisory-soak.json"), JSON.stringify(samples, null, 2));
    await page.evaluate(() => {
      const w = window as any, probe = w.advisorySoak;
      probe.running = false; clearInterval(probe.timer);
      w.xb.core.scene.children.find((o: any) => o.client?.manipulation).client.manipulation.interaction.end();
    });
    fixture.setArmExecution("executing");
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const pill = app.client.manipulation.renderer.warning.object;
      return pill.visible ? pill.children[1].text : null;
    })).toBe("Executing");
    await page.screenshot({ path: info.outputPath("ee-executing-16cm.png") });
  } finally {
    await page.evaluate(() => {
      const probe = (window as any).advisorySoak;
      if (probe) { probe.running = false; clearInterval(probe.timer); probe.unsubscribe(); }
    });
    fixture.close();
  }
});
