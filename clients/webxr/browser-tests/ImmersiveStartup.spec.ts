import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { fileURLToPath } from "node:url";

async function visiblePointerCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
    return [...app.interaction.beams.entries()].filter(([controller, beam]: any) => controller.visible && beam.visible).length;
  });
}

async function setSelection(page: Page, value: number): Promise<void> {
  await page.evaluate(amount => {
    const w = window as any;
    if (w.questDevice.primaryInputMode === "controller") w.questDevice.controllers.right.updateButtonValue("trigger", amount);
    else w.questDevice.hands.right.updatePinchValue(amount);
  }, value);
}

async function activateButton(page: Page, field: "setup" | "retry" = "setup", distance = 0.4): Promise<void> {
  await page.evaluate(({ field, distance }) => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
    const button = app.mainMenu[field];
    const position = button.getWorldPosition(button.position.clone());
    const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
    input.position.set(position.x, position.y, position.z + distance);
    input.quaternion.set(0, 0, 0, 1);
  }, { field, distance });
  // Wait for the actual XR input ray to hover this button before pressing it.
  await expect.poll(() => page.evaluate(field => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
    return app.mainMenu[field].ux.isHovered();
  }, field)).toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    if (w.questDevice.primaryInputMode === "controller") w.questDevice.controllers.right.updateButtonValue("trigger", 1);
    else w.questDevice.hands.right.updatePinchValue(1);
  });
  await expect.poll(() => page.evaluate(field => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
    return app.mainMenu[field].ux.isSelected();
  }, field)).toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    if (w.questDevice.primaryInputMode === "controller") w.questDevice.controllers.right.updateButtonValue("trigger", 0);
    else w.questDevice.hands.right.updatePinchValue(0);
  });
}

for (const [mode, hmd, denyCamera] of [["controller", "quest3", false], ["hand", "quest3s", false], ["controller", "quest3", true]] as const) {
  test(denyCamera ? "refuses to start AR when camera access is denied" : `renders and localizes ${hmd} with ${mode} input`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript({ path: fileURLToPath(new URL("../node_modules/iwer/build/iwer.js", import.meta.url)) });
    await page.addInitScript(inputMode => {
      const w = window as any;
      w.questDevice = new w.IWER.XRDevice(w.IWER.metaQuest3);
      w.questDevice.primaryInputMode = inputMode;
      w.questDevice.installRuntime({ forceInstall: true });
    }, mode);
    let socket: WebSocketRoute | undefined;
    let observations = 0;
    let goals = 0;
    let handshakes = 0;
    await page.routeWebSocket("**/ar", ws => {
      socket = ws;
      const send = (message: object) => ws.send(JSON.stringify(message) + "\n");
      ws.onMessage(raw => {
        if (typeof raw !== "string") {
          observations++;
          // Simulate two marker detection misses before a successful batch.
          if (observations < 3) send({ type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 3 });
          return;
        }
        const command = JSON.parse(raw);
        if (command.type === "nav_goal_request") goals++;
        if (command.type === "hello_request") {
          handshakes++;
          const available = { available: true, reason: null };
          send({ type: "hello", client_id: "browser-test", time_sync: { ts_client: command.ts_client, ts_server: command.ts_client },
            robot: { display_name: "Go2", body_bounds_m: [0.7, 0.5, 0.55], footprint_m: [0.7, 0.3], base_height_m: 0.33 },
            capabilities: { lidar: available, localization: available, estop: available, agent: available,
              navigation: { ...available, nav_goal: available, nav_joystick: available } } });
          send({ type: "state", server: { connected_clients: 1 }, lidar: { enabled: false, min_height_m: 0, max_height_m: 2, max_range_m: 5 }, nav: { state: "idle", outcome: null }, agent: { idle: true } });
          send({ type: "pose", position: [2, 0, 0.33], orientation: [0, 0, 0, 1], ts: command.ts_client });
        }
        if (command.type === "localization_start_request") send({ type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 3 });
      });
    });
    await page.goto("/?debug=1");
    await expect(page.locator("#enter")).toBeEnabled();
    await expect(page).toHaveTitle("DimOS ARModule");
    await expect(page.locator("body > #overlay header")).toHaveText("DimOS ARModule");
    await expect(page.locator("#overlay main > *")).toHaveCount(4);
    await page.selectOption("#hmd", hmd);
    await page.screenshot({ path: testInfo.outputPath("landing.png") });
    const cameraAccessRequests = await page.evaluate(denyFirstPermission => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const camera = app.client.camera;
      for (const controller of w.xb.core.input.controllers.slice(0, 2)) {
        const shell = app.mainMenu.setup.mesh.clone();
        shell.name = "Rig self-hit regression surface";
        shell.layers.set(0);
        shell.scale.setScalar(0.04);
        shell.position.set(0, 0, -0.02);
        shell.quaternion.identity();
        controller.add(shell);
      }

      const track = { label: "camera 1, facing back", stop() {}, getSettings: () => ({ width: 1280, height: 960, frameRate: 30, facingMode: "environment", deviceId: "test-left" }) };
      const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
      w.cameraPermissionRequests = 0;
      camera.media = { getUserMedia: async (constraints: MediaStreamConstraints) => {
        w.cameraPermissionRequests++;
        if (w.cameraPermissionRequests === 1) {
          if (JSON.stringify(constraints).includes("exact")) throw new DOMException("Pre-permission constraint failure", "OverconstrainedError");
          await new Promise<void>(resolve => { w.resolveCameraPermission = resolve; });
        }
        if (denyFirstPermission && w.cameraPermissionRequests === 1) throw new DOMException("Permission denied", "NotAllowedError");
        const video = constraints.video as MediaTrackConstraints;
        if (video.deviceId && JSON.stringify(video.deviceId) !== JSON.stringify({ exact: "test-left" })) {
          throw new Error("Wrong physical camera selected");
        }
        return stream;
      }, enumerateDevices: async () => [
        { kind: "videoinput", label: "camera 0, facing front", deviceId: "test-avatar" },
        { kind: "videoinput", label: "camera 2, facing back", deviceId: "test-right" },
        { kind: "videoinput", label: track.label, deviceId: "test-left" },
      ] };
      camera.videoFactory = () => ({ play: async () => {}, pause() {}, srcObject: null });
      camera.jpeg = { encode: async () => ({ jpeg: new Uint8Array([255, 216, 255, 217]), width: 1280, height: 960 }) };
      let timer: ReturnType<typeof setInterval>;
      camera.frames = { start: (_video: any, onFrame: any) => { timer = setInterval(() => onFrame({}, { captureTime: performance.now() }), 30); }, stop: () => clearInterval(timer) };
      return { panel: app.mainMenu.panel.visible };
    }, denyCamera);
    expect(cameraAccessRequests.panel).toBe(true);
    await page.locator("#enter").click();
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return w.cameraPermissionRequests;
    })).toBe(1);
    // A pending camera permission must never enter immersive mode.
    expect(await page.evaluate(() => (window as any).xb.core.renderer.xr.isPresenting)).toBe(false);
    await expect(page.locator("#enter")).toBeDisabled();
    await page.evaluate(() => (window as any).resolveCameraPermission());
    if (denyCamera) {
      await expect(page.locator("#status")).toContainText("Camera access was denied");
      await expect(page.locator("#enter")).toBeEnabled();
      expect(await page.evaluate(() => {
        const w = window as any;
        return w.xb.core.renderer.xr.isPresenting;
      })).toBe(false);
      await page.locator("#enter").click();
      await expect(page.locator("#enter")).toHaveText("Enter AR");
      await expect(page.locator("#enter")).toBeEnabled();
      await expect(page.locator("#status")).toBeEmpty();
      expect(await page.evaluate(() => (window as any).xb.core.renderer.xr.isPresenting)).toBe(false);
      expect(errors).toEqual([]);
      return;
    }
    await expect(page.locator("#enter")).toHaveText("Enter AR");
    expect(await page.evaluate(() => (window as any).xb.core.renderer.xr.isPresenting)).toBe(false);
    await page.locator("#enter").click();
    const ui = () => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app?.client.ui.snapshot();
    });
    await expect.poll(async () => (await ui())?.wizardTitle).toBe("Connect");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app?.mainMenu?.setup?.textObj?.textRenderInfo?.glyphBounds.length ?? 0;
    })).toBeGreaterThan(0);
    const visible = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const button = app.mainMenu.setup;
      const scale = button.getWorldScale(button.scale.clone());
      return { titleFontHeight: app.mainMenu.title.textObj.fontSize * app.mainMenu.title.textObj.getWorldScale(app.mainMenu.title.scale.clone()).y, panelScale: app.mainMenu.panel.scale.x, panel: app.mainMenu.panel.visible, fontHeight: button.textObj.fontSize * scale.y, opacity: button.opacity };
    });
    expect(visible.panelScale).toBeCloseTo(0.68 * 0.6);
    expect(visible.titleFontHeight).toBeGreaterThan(0.02);
    expect(visible.titleFontHeight).toBeLessThan(0.04);
    expect(visible.panel).toBe(true);
    expect(visible.fontHeight).toBeGreaterThan(0.012);
    expect(visible.opacity).toBe(1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return [...app.interaction.beams.entries()].filter(([controller, beam]: any) => controller.visible && beam.visible).length;
    })).toBe(2);
    await page.screenshot({ path: testInfo.outputPath(`wizard-${mode}.png`) });
    // Exercise real button callbacks close up and at range, with a 2cm rig occluder present.
    const panelPosition = await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.toArray();
    });
    for (const distance of [0.05, 3]) {
      await page.evaluate(distance => {
        const w = window as any;
        w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.z = -(distance + 0.25);
      }, distance);
      const before = handshakes;
      await activateButton(page, "retry", distance);
      await expect.poll(() => handshakes).toBe(before + 1);
      await expect.poll(async () => (await ui())?.wizardCardTitle).toBe("Robot connected");
      const length = await page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        const controller = w.xb.core.input.rightController;
        return app.interaction.beams.get(controller).scale.z;
      });
      expect(length).toBeCloseTo(distance, 2);
    }
    await page.evaluate(position => {
      const w = window as any;
      w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.fromArray(position);
    }, panelPosition);

    // Resize by grabbing an edge through real XR selection while setup is open.
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const panel = app.mainMenu.panel;
      const edge = panel.localToWorld(panel.position.clone().set(0.65, 0, 0));
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(edge.x, edge.y, edge.z + 0.4);
      input.quaternion.set(0, 0, 0, 1);
    });
    await page.waitForTimeout(150);
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return Boolean(w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").panelHold);
    })).toBe(true);
    const resizing = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.x += 0.08;
      return { resize: app.mainMenu.manipulation.resize, scale: app.mainMenu.manipulation.scale };
    });
    expect(resizing.resize).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.scale.x;
    })).toBeGreaterThan(visible.panelScale);
    await setSelection(page, 0);

    const beforeGrab = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const panel = app.mainMenu.panel;
      panel.updateWorldMatrix(true, true);
      const local = panel.position.clone().set(0, w.questDevice.primaryInputMode === "controller" ? 0 : 0.42, 0);
      const target = panel.localToWorld(local);
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(target.x, target.y, target.z + 0.4);
      input.quaternion.set(0, 0, 0, 1);
      return panel.quaternion.toArray();
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.mainMenu.ownsTarget(app.interaction.hit(w.xb.core.input.rightController)?.object);
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      if (w.questDevice.primaryInputMode === "controller") w.questDevice.controllers.right.updateButtonValue("squeeze", 1);
      else w.questDevice.hands.right.updatePinchValue(1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return Boolean(w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").panelHold);
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.quaternion.set(0, 0, Math.sin(0.2), Math.cos(0.2));
    });
    await expect.poll(() => page.evaluate(before => {
      const w = window as any;
      const panel = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel;
      return panel.quaternion.angleTo(panel.quaternion.clone().fromArray(before));
    }, beforeGrab)).toBeGreaterThan(0.3);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(before => {
      const w = window as any;
      const panel = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel;
      return panel.quaternion.angleTo(panel.quaternion.clone().fromArray(before));
    }, beforeGrab)).toBeLessThan(0.01);
    await page.evaluate(() => {
      const w = window as any;
      if (w.questDevice.primaryInputMode === "controller") w.questDevice.controllers.right.updateButtonValue("squeeze", 0);
      else w.questDevice.hands.right.updatePinchValue(0);
    });

    await expect.poll(async () => (await ui())?.wizardStep).toBe("connect");
    await expect.poll(async () => (await ui())?.wizardCardTitle).toBe("Robot connected");
    await page.screenshot({ path: testInfo.outputPath("connected.png") });
    await activateButton(page);
    await expect.poll(async () => (await ui())?.wizardStep).toBe("localization");
    await expect.poll(() => observations, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(0.3, 1.2, -0.2);
      input.quaternion.set(0, -Math.sin(Math.PI / 18), 0, Math.cos(Math.PI / 18));
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const controller = w.xb.core.input.rightController;
      const beam = app.interaction.beams.get(controller);
      return controller.visible && beam?.visible && beam.scale.z === 3;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("laser-empty-space.png") });

    expect((await ui()).localizationIssue).toBeNull();
    await page.screenshot({ path: testInfo.outputPath("localization.png") });
    // The server can finish while a system overlay temporarily blurs XR.
    await page.evaluate(() => {
      const w = window as any;
      const session = w.xb.core.renderer.xr.getSession();
      Object.defineProperty(session, "visibilityState", { value: "visible-blurred", writable: true, configurable: true });
      session.dispatchEvent(new Event("visibilitychange"));
    });
    socket!.send(JSON.stringify({ type: "localization_result", position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 10 }) + "\n");
    await expect.poll(async () => (await ui())?.setupCompleted).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      const session = w.xb.core.renderer.xr.getSession();
      session.visibilityState = "visible";
      session.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await ui())?.hasTrackingOrigin).toBe(true);
    await expect.poll(() => visiblePointerCount(page)).toBe(2);
    // Headset standby changes focus, while the same immersive session continues.
    await page.evaluate(() => {
      const w = window as any;
      const session = w.xb.core.renderer.xr.getSession();
      session.visibilityState = "hidden";
      session.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => visiblePointerCount(page)).toBe(0);
    expect((await ui())?.setupCompleted).toBe(true);
    expect((await ui())?.hasTrackingOrigin).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      const session = w.xb.core.renderer.xr.getSession();
      session.visibilityState = "visible";
      session.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => visiblePointerCount(page)).toBe(2);
    expect((await ui())?.setupCompleted).toBe(true);
    expect((await ui())?.hasTrackingOrigin).toBe(true);


    // World-object targeting also works near and far, not just the UI path.
    for (const distance of [0.05, 3]) {
      await page.evaluate(distance => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        const target = app.client.navigation.marker.pose().position;
        const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
        const offset = distance / Math.sqrt(2);
        input.position.set(target[0], target[1] + 0.023 + offset, target[2] + offset);
        input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
      }, distance);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        let object = app.interaction.hit(w.xb.core.input.rightController)?.object;
        while (object) {
          if (object === app.client.navigation.marker.object) return true;
          object = object.parent;
        }
        return false;
      })).toBe(true);
      const length = await page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        return app.interaction.beams.get(w.xb.core.input.rightController).scale.z;
      });
      expect(length).toBeCloseTo(distance, 2);
      await setSelection(page, 1);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        return Boolean(w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").worldHold);
      })).toBe(true);
      await setSelection(page, 0);
    }

    // Aim at and drag the navigation marker without detected room planes.
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const target = app.client.navigation.marker.pose().position;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(target[0], target[1] + 0.5, target[2] + 0.5);
      input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
    });
    await page.waitForTimeout(150);
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return Boolean(w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").worldHold);
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.x += 0.8;
    });
    await expect.poll(() => goals).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return [...app.interaction.beams.values()].some((beam: any) => beam.visible && beam.material.color.getHex() === 0xff8a24);
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("laser-navigation.png") });
    await setSelection(page, 0);

    socket!.send(JSON.stringify({ type: "nav_goal", ts: 10, pose: [1.1, 0.45, 0, 0],
      path_poses: [[2, 0, 0, 0], [1.5, 0, 0, 0], [1.1, 0.45, 0, 0]] }) + "\n");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const route = app.client.route.object;
      return route.visible && route.material.color.getHex() === 0xffffff &&
        route.material.worldUnits && route.material.linewidth === 0.015;
    })).toBe(true);

    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      app.client.ui.toggleMenu();
    });
    await expect.poll(async () => (await ui())?.menuOpen).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.mainMenu.robotName.text;
    })).toBe("Go2");
    await page.screenshot({ path: testInfo.outputPath("runtime.png") });
    const menuBelowEyes = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return w.questDevice.position.y - app.mainMenu.panel.position.y;
    });
    expect(menuBelowEyes).toBeCloseTo(0.18, 2);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.connected = false;
    });
    await expect.poll(() => visiblePointerCount(page)).toBe(1);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.connected = true;
    });
    await expect.poll(() => visiblePointerCount(page)).toBe(2);

    const initialMenuX = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      w.questDevice.quaternion.set(0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8));
      return app.mainMenu.panel.position.x;
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.x;
    })).toBeLessThan(initialMenuX - 0.04);
    const followingX = await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.x;
    });
    expect(followingX).toBeGreaterThan(initialMenuX - 0.6);
    await page.evaluate(() => (window as any).questDevice.quaternion.set(0, 0, 0, 1));

    const markerParts = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const origin = app.client.originStore.T_odom_client;
      app.client.markers.apply({ id: "preview", x: 1, y: 0, z: 0, title: "Docking point" }, origin);
      const marker = app.client.markers.object.children[0];
      marker.position.set(0.45, 0, -1.1);
      app.client.navigation.marker.setPose([-0.45, 0, -1.1], [0, 0, 0, 1]);
      app.client.navigation.marker.show();
      app.client.ui.toggleMenu();
      return marker.children.length;
    });
    expect(markerParts).toBeGreaterThanOrEqual(6);
    await page.screenshot({ path: testInfo.outputPath("world-marker.png") });
    await page.evaluate(() => {
      const w = window as any;
      w.questDevice.quaternion.set(-Math.sin(0.65 / 2), 0, 0, Math.cos(0.65 / 2));
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: testInfo.outputPath("navigation-marker.png") });
    expect(errors).toEqual([]);
  });
}

test("renders full growing paths and keeps LiDAR behind opaque and transparent UI", async ({ page }) => {
  await page.goto("/?debug=1");
  const pixels = await page.evaluate(async () => {
    const fixture = await import("/browser-tests/fixtures/Rendering.ts");
    return fixture.verifyRendering();
  });
  expect(pixels.longEnd.slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels.shortEnd.slice(0, 3)).toEqual([0, 0, 0]);
  expect(pixels.regrownEnd.slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels.opaqueUi.slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels.transparentUi.slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels.lidarOnly.slice(0, 3)).not.toEqual([255, 255, 255]);
  expect(pixels.lidarOnly.slice(0, 3)).not.toEqual([0, 0, 0]);
});
