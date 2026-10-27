import { saveCaseProof } from "./fixtures/CaseProof";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { startVisualReview, markVisualReview, saveVisualReview } from "./fixtures/VisualReview";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { State } from "../../../specs/Assets/Scripts/DimOSARClient/websocket/protocolTypes";

// ClientCore lives outside WebXR's ESM package. Load it through Playwright's
// CommonJS transform so test discovery also works on CI's Node 20 runtime.
const { ROBOT_LINE_STYLE } = createRequire(import.meta.url)(
  "../../../specs/Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle",
) as typeof import("../../../specs/Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle");

test.beforeEach(async ({ page }) => startVisualReview(page));
test.afterEach(async ({ page }, info) => {
  await saveVisualReview(page, info);
  await saveCaseProof(info, info.title.startsWith("refuses") ? ["browser_permissions"] : info.title.startsWith("renders and localizes") ? ["panel_resize"] : []);
});

import { visiblePointerCount, setSelection, activateButton, pointRuntimeButton, activateRuntimeButton, frameMenu, restoreView, placeDirect } from "./fixtures/Input";

async function captureMenu(page: Page, path: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const w = window as any;
    const menu = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu;
    return menu.panelProgress >= 0.999 && [...menu.pageTransitions.values()].every((state: any) => state.progress === (state.target ? 1 : 0));
  })).toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
    input.position.set(0.8, 1.1, -0.3);
    input.quaternion.set(0, 0, 0, 1);
    document.body.style.background = "#182028";
    document.querySelector("canvas")!.style.background = "#182028";
  });
  // Stress-test transcript captures keep the normal headset pose; review scenes
  // use close framing and a readable hold in the interaction video.
  const close = !path.includes("long-messages") && !path.includes("scrolled-messages");
  const view = close ? await frameMenu(page) : null;
  if (close) await page.waitForTimeout(1000);
  markVisualReview(page, path.split("/").pop()!);
  await page.screenshot({ path });
  if (close) await page.waitForTimeout(1000);
  if (view) await restoreView(page, view);
  await page.evaluate(() => {
    document.body.style.background = "";
    document.querySelector("canvas")!.style.background = "";
  });
}

for (const [mode, hmd, denyCamera] of [["controller", "quest3", false], ["hand", "quest3s", false], ["controller", "quest3", true]] as const) {
  test(denyCamera ? "refuses to start AR when camera access is denied" : `renders and localizes ${hmd} with ${mode} input`, async ({ page }, testInfo) => {
    test.setTimeout(360000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript({ path: fileURLToPath(new URL("../../node_modules/iwer/build/iwer.js", import.meta.url)) });
    await page.addInitScript(inputMode => {
      const w = window as any;
      w.questDevice = new w.IWER.XRDevice(w.IWER.metaQuest3);
      w.questDevice.primaryInputMode = inputMode;
      w.questDevice.installRuntime({ forceInstall: true });
    }, mode);
    let socket: WebSocketRoute | undefined;
    let serverState: State = { type: "state", server: { connected_clients: 1 },
      lidar: { enabled: false, min_height_m: 0, max_height_m: 2, max_range_m: 5 },
      nav: { state: "idle", outcome: null }, agent: { idle: true } };
    const sendState = (update: Partial<State> = {}, peer = socket) => {
      serverState = { ...serverState, ...update };
      peer!.send(JSON.stringify(serverState) + "\n");
    };
    let observations = 0;
    let latestCaptureTs = 0;
    let goals = 0;
    let handshakes = 0;
    let estops = 0;
    const agentMessages: string[] = [];
    await page.routeWebSocket("**/ar", ws => {
      socket = ws;
      const send = (message: object) => ws.send(JSON.stringify(message) + "\n");
      ws.onMessage(raw => {
        if (typeof raw !== "string") {
          observations++;
          // Mirror ARModule's existing result timestamp: newest submitted capture.
          const packet = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          let offset = 6;
          for (let index = 0; index < packet.getUint16(4, true); index++) {
            latestCaptureTs = Math.max(latestCaptureTs, packet.getFloat64(offset + 4, true));
            offset += 4 + packet.getUint32(offset, true);
          }
          // Simulate two marker detection misses before a successful batch.
          if (observations < 3) send({ type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 3 });
          return;
        }
        const command = JSON.parse(raw);
        if (command.type === "state_request") sendState({}, ws);
        if (command.type === "lidar_settings_request") {
          sendState({ lidar: { enabled: command.enabled, min_height_m: command.min_height_m,
            max_height_m: command.max_height_m, max_range_m: command.max_range_m } }, ws);
        }
        if (command.type === "estop_request") estops++;
        if (command.type === "user_message_request") {
          agentMessages.push(command.text);
          send({ type: "agent_message", text: "I will go forward to the requested location." });
        }
        if (command.type === "nav_goal_request") {
          if (command.preview) {
            const [x, y, z] = command.position;
            send({ type: "nav_goal", preview: true, preview_id: command.preview_id, pose: [x, y, z, 0], path_poses: [[2, 0, 0, 0], [x, y, z, 0]], ts: performance.now() });
          } else goals++;
        }
        if (command.type === "hello_request") {
          handshakes++;
          const available = { available: true, reason: null };
          send({ type: "hello", client_id: "browser-test", time_sync: { ts_client: command.ts_client, ts_server: command.ts_client },
            server_info: { robot_ip: "192.168.1.42", dimos_version: "0.4.0", armodule_version: "0.2.0" },
            robot: { display_name: "Unitree Go2", body_bounds_m: [0.7, 0.5, 0.55], footprint_m: [0.7, 0.3], base_height_m: 0.33 },
            capabilities: { lidar: available, localization: available, estop: available, agent: available,
              navigation: { ...available, nav_goal: { ...available, preview: true }, nav_joystick: available } } });
          sendState({}, ws);
          send({ type: "pose", position: [2, 0, 0.33], orientation: [0, 0, 0, 1], ts: command.ts_client });
        }
        if (command.type === "localization_start_request") send({ type: "localization_observations_request", capture_policy: "robot_los_required", observation_count: 3 });
      });
    });
    await page.goto("/?debug=1");
    await expect(page.locator("#enter")).toBeEnabled({ timeout: 15000 });
    await expect(page).toHaveTitle("dimOS AR");
    await expect(page.locator("body > #overlay header")).toHaveText("dimOS AR");
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
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = 1280; previewCanvas.height = 960;
      const ctx = previewCanvas.getContext("2d")!;
      ctx.fillStyle = "#505762"; ctx.fillRect(0, 0, 1280, 960);
      ctx.fillStyle = "white"; ctx.fillRect(520, 360, 240, 240);
      ctx.fillStyle = "black"; ctx.fillRect(540, 380, 200, 200);
      ctx.fillStyle = "white"; ctx.fillRect(570, 410, 50, 110); ctx.fillRect(650, 470, 60, 70);
      const originalPreview = camera.previewFrame.bind(camera);
      camera.previewFrame = () => originalPreview() ? { video: previewCanvas, width: 1280, height: 960 } : null;
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
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Camera access was denied");
      await page.screenshot({ path: testInfo.outputPath("browser_permissions.png") });
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
    await expect.poll(async () => (await ui())?.wizardTitle, { timeout: 15000 }).toBe("Connect");
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
      return { textGap: button.textObj.position.z * button.getWorldScale(button.scale.clone()).z, titleFontHeight: app.mainMenu.title.textObj.fontSize * app.mainMenu.title.textObj.getWorldScale(app.mainMenu.title.scale.clone()).y, panelScale: app.mainMenu.panel.scale.x, panel: app.mainMenu.panel.visible, fontHeight: button.textObj.fontSize * scale.y, opacity: button.opacity };
    });
    expect(visible.panelScale).toBeCloseTo(0.76 * 0.432);
    expect(visible.textGap).toBeCloseTo(0.0005, 6);
    expect(visible.titleFontHeight).toBeGreaterThan(0.012);
    expect(visible.titleFontHeight).toBeLessThan(0.024);
    expect(visible.panel).toBe(true);
    expect(visible.fontHeight).toBeGreaterThan(0.0072);
    expect(visible.opacity).toBe(1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return [...app.interaction.beams.entries()].filter(([controller, beam]: any) => controller.visible && beam.mesh.visible).length;
    })).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`wizard-${mode}.png`) });
    // Exercise real button callbacks close up and at range, with a 2cm rig occluder present.
    const panelPosition = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      // This test places the panel at explicit near/far distances. Pin setup
      // follow first so the panel does not move away during the actual press.
      app.setupPlacement.pin();
      return app.mainMenu.panel.position.toArray();
    });
    for (const distance of [0.15, 3]) {
      await page.evaluate(distance => {
        const w = window as any;
        w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.z = -(distance + 0.25);
      }, distance);
      const before = handshakes;
      await activateButton(page, "retry", distance);
      await expect.poll(() => handshakes).toBe(before + 1);
      await expect.poll(async () => (await ui())?.wizardCardTitle).toBe("Connected to dimOS ARModule");
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        const controller = w.xb.core.input.rightController;
        const beam = app.interaction.beams.get(controller);
        return beam.tip.distanceTo(controller.getWorldPosition(beam.tip.clone())) - app.interaction.hit(controller).distance;
      })).toBeCloseTo(0, 2);
    }
    await page.evaluate(position => {
      const w = window as any;
      w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.fromArray(position);
    }, panelPosition);

    // Resize by grabbing a corner through real XR selection while setup is open.
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const panel = app.mainMenu.panel;
      const corner = app.mainMenu.cornerZones.right;
      const edge = corner.getWorldPosition(panel.position.clone());
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
    await page.screenshot({ path: testInfo.outputPath("panel_resize.png") });
    await setSelection(page, 0);

    let beforeGrab = await page.evaluate(() => {
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
    beforeGrab = await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").mainMenu.manipulation.rotation.toArray();
    });
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      // Panels yaw and tilt with the grab but never roll.
      input.quaternion.set(0, Math.sin(0.2), Math.sin(0.1), Math.cos(0.2));
      input.quaternion.normalize();
    });
    await expect.poll(() => page.evaluate(before => {
      const w = window as any;
      const panel = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel;
      return panel.quaternion.angleTo(panel.quaternion.clone().fromArray(before));
    }, beforeGrab)).toBeGreaterThan(0.3);
    expect(await page.evaluate(() => {
      const w = window as any;
      const panel = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel;
      return Math.abs(new panel.rotation.constructor().setFromQuaternion(panel.quaternion, "YXZ").z);
    })).toBeLessThan(0.01);
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
    await expect.poll(async () => (await ui())?.wizardCardTitle).toBe("Connected to dimOS ARModule");
    const connectedView = await frameMenu(page);
    markVisualReview(page, "connected.png");
    await page.screenshot({ path: testInfo.outputPath("connected.png") });
    await restoreView(page, connectedView);
    const beforeNear = handshakes;
    await placeDirect(page, "retry");
    await setSelection(page, 1); await page.waitForTimeout(100);
    await placeDirect(page, "retry");
    await setSelection(page, 0);
    await expect.poll(() => handshakes).toBe(beforeNear + 1);
    await activateButton(page);
    await expect.poll(async () => (await ui())?.wizardStep).toBe("localization");
    await expect.poll(() => observations, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      // Point away from any affordance: an extended hand alone must not reveal a laser.
      input.position.set(0.3, 1.2, -0.45);
      input.quaternion.set(0, -Math.sin(Math.PI / 18), 0, Math.cos(Math.PI / 18));
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const controller = w.xb.core.input.rightController;
      const beam = app.interaction.beams.get(controller);
      return controller.visible && beam && !beam.mesh.visible;
    })).toBe(true);
    markVisualReview(page, "laser-empty-space.png");
    await page.screenshot({ path: testInfo.outputPath("laser-empty-space.png") });

    expect((await ui()).localizationIssue).toBeNull();
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const menu = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu;
      return menu.preview.userData.frameVersion ?? 0;
    })).toBeGreaterThan(0);
    const localizationView = await frameMenu(page);
    markVisualReview(page, "localization.png");
    await page.screenshot({ path: testInfo.outputPath("localization.png") });
    await restoreView(page, localizationView);
    // The server can finish while a system overlay temporarily blurs XR.
    await page.evaluate(() => {
      const w = window as any;
      const session = w.xb.core.renderer.xr.getSession();
      Object.defineProperty(session, "visibilityState", { value: "visible-blurred", writable: true, configurable: true });
      session.dispatchEvent(new Event("visibilitychange"));
    });
    socket!.send(JSON.stringify({ type: "localization_result", position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: latestCaptureTs }) + "\n");
    await expect.poll(async () => (await ui())?.setupCompleted).toBe(true);
    const setupsuccessView = await frameMenu(page);
    await page.evaluate(() => {
      const w = window as any;
      const session = w.xb.core.renderer.xr.getSession();
      session.visibilityState = "visible";
      session.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await ui())?.hasTrackingOrigin).toBe(true);
    await expect.poll(async () => (await ui())?.setupCelebrating).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const menu = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").mainMenu;
      return menu.success.visible && menu.successRing.geometry.drawRange.count > 0;
    })).toBe(true);
    await expect.poll(async () => (await ui())?.setupSuccessProgress, { intervals: [30, 50, 100] }).toBeGreaterThan(0.95);
    markVisualReview(page, "setup-success.png");
    await page.screenshot({ path: testInfo.outputPath("setup-success.png") });
    await page.waitForTimeout(250);
    await restoreView(page, setupsuccessView);
    await expect.poll(async () => (await ui())?.setupCelebrating).toBe(false);
    await expect.poll(() => page.evaluate(() => { const w = window as any; return w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").tracking; })).toBe(true);
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
    await expect.poll(() => page.evaluate(() => { const w = window as any; return w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").tracking; })).toBe(true);
    expect((await ui())?.setupCompleted).toBe(true);
    expect((await ui())?.hasTrackingOrigin).toBe(true);


    await expect.poll(async () => (await ui()).alignmentReview?.pending).toBe(true);
    await captureMenu(page, testInfo.outputPath("alignment-review.png"));
    await activateRuntimeButton(page, "Dismiss");
    await expect.poll(async () => (await ui()).alignmentReview?.pending).toBe(false);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.ui.menuOpen = false;
    });

    const captureWorld = async (name: string, aiming: boolean) => {
      const saved = await page.evaluate(aiming => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        const robot = app.client.robot;
        const position = robot.object.position.clone();
        if (aiming) position.lerp(app.client.navigation.draftMarker.object.position, 0.5);
        const head = w.questDevice;
        const saved = { x: head.quaternion.x, y: head.quaternion.y, z: head.quaternion.z, w: head.quaternion.w };
        const direction = position.sub(robot.object.position.clone().set(head.position.x, head.position.y, head.position.z)).normalize();
        const rotation = robot.object.quaternion.clone().setFromUnitVectors(robot.object.position.clone().set(0, 0, -1), direction);
        head.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        w.xb.core.scene.background = robot.collider.material.color.clone().setHex(0x182028);
        document.body.style.background = "#182028";
        document.querySelector("canvas")!.style.background = "#182028";
        return saved;
      }, aiming);
      await expect.poll(() => page.evaluate(({ aiming, dashStyle }) => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        if (!aiming) return app.client.robot.object.getObjectByName("Robot selection outline").material.opacity >= 0.79;
        const navigation = app.client.navigation;
        const draft = navigation.draftMarker;
        const dashed = draft.object.getObjectByName("Navigation draft circle");
        return draft.object.visible &&
          Math.abs(draft.circleBounds().radius - navigation.marker.circleBounds().radius) < 0.0001 &&
          draft.circleBounds().radius > 0.24 && dashed.visible &&
          !draft.object.getObjectByName("NavigationCircle").visible &&
          draft.object.getObjectByName("NavigationHeading").visible &&
          Math.abs(dashed.material.uniforms.uDash.value - dashStyle.dashM) < 0.00001 &&
          Math.abs(dashed.material.uniforms.uGap.value - dashStyle.gapM) < 0.00001 &&
          Math.abs(dashed.material.uniforms.uWidth.value - dashStyle.selectedWidthM) < 0.00001;
      }, { aiming, dashStyle: ROBOT_LINE_STYLE })).toBe(true);
      markVisualReview(page, name);
      await page.screenshot({ path: testInfo.outputPath(name) });
      await page.evaluate(saved => {
        const w = window as any;
        w.questDevice.quaternion.set(saved.x, saved.y, saved.z, saved.w);
        w.xb.core.scene.background = null;
        document.body.style.background = "";
        document.querySelector("canvas")!.style.background = "";
      }, saved);
    };

    // Select the robot through its invisible body collider using the real trigger/pinch path.
    const pointAtRobot = async () => {
      await page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        const collider = app.client.robot.collider;
        const center = collider.getWorldPosition(collider.position.clone());
        const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
        input.position.set(center.x, center.y, center.z + 1);
        input.quaternion.set(0, 0, 0, 1);
      });
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        return app.interaction.hit(w.xb.core.input.rightController)?.object === app.client.robot.collider;
      })).toBe(true);
    };
    // A near miss must not leave the unselected robot highlighted.
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const collider = app.client.robot.collider;
      const center = collider.getWorldPosition(collider.position.clone());
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(center.x + 0.28, center.y, center.z + 0.8); input.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return { selected: app.client.robot.isSelected(), hovered: app.interaction.hoverTargets().includes(app.client.robot.collider), hits: app.interaction.hoverTargets().map((o: any) => o.name), opacity: app.client.robot.object.getObjectByName("Robot selection outline").material.opacity };
    })).toMatchObject({ selected: false, hovered: false, opacity: 0 });
    await pointAtRobot();
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.robot.isSelected();
    })).toBe(true);
    await setSelection(page, 0);
    await captureWorld("robot-selected.png", false);
    // Floor aim starts with a separate probe and preserves the robot marker until confirmed.
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const robot = app.client.robot.worldPosition();
      const floor = app.client.robot.floorWorldY();
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(robot[0] + 1, floor + 0.5, robot[2]);
      input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const probes = app.client.navigation.probeRoot.children.filter((probe: any) => probe.visible);
      return probes.length > 0 && probes.every((probe: any) => {
        const circle = probe.getObjectByName("Navigation probe circle");
        const start = circle.geometry.getAttribute("instanceStart");
        return circle.geometry.instanceCount === 128 && circle.position.y === 0 &&
          Math.abs(Math.hypot(start.getX(0), start.getZ(0)) + circle.material.uniforms.uWidth.value / 2 - 0.06) < 0.00001;
      }) && !app.client.navigation.isAiming() && !app.client.route.object.visible;
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const robot = app.client.robot.worldPosition(), floor = app.client.robot.floorWorldY();
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.left : w.questDevice.hands.left;
      input.position.set(robot[0] - 1, floor + 0.5, robot[2]);
      input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.client.navigation.interaction.snapshot().probes.length;
    })).toBe(2);
    markVisualReview(page, "floor-probe.png");
    await page.screenshot({ path: testInfo.outputPath("floor-probe.png") });
    const beforePreviewClick = goals;
    await setSelection(page, 1); await setSelection(page, 0);
    expect(goals).toBe(beforePreviewClick);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.client.navigation.isAiming() && app.client.previewRoute.object.visible && app.client.navigation.draftMarker.object.visible;
    })).toBe(true);
    await captureWorld("floor-aim-preview.png", true);
    const beforeFloorClick = goals;
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return Boolean(w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").worldHold);
    })).toBe(true);
    expect(goals).toBe(beforeFloorClick);
    await setSelection(page, 0);
    await expect.poll(() => goals).toBe(beforeFloorClick + 1);
    // Toggle off to verify that marker dragging remains usable without selection.
    await pointAtRobot();
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.robot.isSelected();
    })).toBe(false);
    await setSelection(page, 0);

    // Detached marker targeting works near and far without highlighting the robot box.
    for (const distance of [0.15, 3]) {
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
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        const controller = w.xb.core.input.rightController;
        const beam = app.interaction.beams.get(controller);
        return beam.tip.distanceTo(controller.getWorldPosition(beam.tip.clone())) - app.interaction.hit(controller).distance;
      })).toBeCloseTo(0, 2);
      await setSelection(page, 1);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        return Boolean(w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").worldHold);
      })).toBe(true);
      await setSelection(page, 0);
    }

    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const outline = app.client.robot.object.getObjectByName("Robot selection outline");
      return !app.client.robot.isSelected() && !app.client.robot.hovered &&
        !app.client.navigation.interaction.snapshot().attachedToRobot &&
        outline.material.opacity < 0.005;
    })).toBe(true);
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
      return [...app.interaction.beams.values()].some((beam: any) => beam.mesh.visible && beam.mesh.material.uniforms.uColor.value.getHex() === 0xffffff);
    })).toBe(true);
    markVisualReview(page, "laser-navigation.png");
    await page.screenshot({ path: testInfo.outputPath("laser-navigation.png") });
    await setSelection(page, 0);

    socket!.send(JSON.stringify({ type: "nav_goal", ts: 10, pose: [1.1, 0.45, 0, 0],
      path_poses: [[2, 0, 0, 0], [1.5, 0, 0, 0], [1.1, 0.45, 0, 0]] }) + "\n");
    await expect.poll(() => page.evaluate(dashStyle => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const route = app.client.route.object;
      const dashed = route.children.find((child: any) => child.material?.uniforms?.uDash);
      return route.visible && route.material.color.getHex() === 0xffffff &&
        route.material.worldUnits && Math.abs(route.material.linewidth - dashStyle.selectedWidthM) < 0.00001 && route.material.dashed && route.material.opacity === 0.85 &&
        dashed.visible && Math.abs(dashed.material.uniforms.uDash.value - dashStyle.dashM) < 0.00001 &&
        Math.abs(dashed.material.uniforms.uGap.value - dashStyle.gapM) < 0.00001;
    }, ROBOT_LINE_STYLE)).toBe(true);

    sendState({ nav: { state: "following_path", outcome: null } });
    const beforeFollowingView = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const saved = [w.questDevice.quaternion.x, w.questDevice.quaternion.y, w.questDevice.quaternion.z, w.questDevice.quaternion.w];
      const target = app.client.navigation.marker.object.position.clone();
      const direction = target.sub(target.clone().set(w.questDevice.position.x, w.questDevice.position.y, w.questDevice.position.z)).normalize();
      const rotation = app.client.robot.object.quaternion.clone().setFromUnitVectors(target.clone().set(0, 0, -1), direction);
      w.questDevice.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      return saved;
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").client.navigation.marker.object.getObjectByName("NavigationCircle").material.opacity;
    })).toBeGreaterThan(0.99);
    await page.waitForTimeout(1200);
    markVisualReview(page, "following-path.png");
    await page.screenshot({ path: testInfo.outputPath("following-path.png") });


    // Selected marker dragging streams goals and finishes without creating a draft.
    const beforeDraftGoals = goals;
    const savedActiveGoal = await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.setRobotSelected(true);
      const target = app.client.navigation.marker.pose().position;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(target[0], target[1] + 0.5, target[2] + 0.5);
      input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
      return target;
    });
    await page.waitForTimeout(180); await setSelection(page, 1);
    await page.evaluate(() => {
      const w = window as any, input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.x += 0.35;
    });
    await page.waitForTimeout(180); await setSelection(page, 0);
    expect(goals).toBeGreaterThan(beforeDraftGoals);
    await expect.poll(() => page.evaluate(saved => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const navigation = app.client.navigation;
      return !navigation.draftMarker.object.visible && navigation.marker.object.visible &&
        !navigation.interaction.isDragging() && !navigation.interaction.snapshot().draft &&
        Math.abs(navigation.marker.pose().position[0] - saved[0]) > 0.3;
    }, savedActiveGoal)).toBe(true);
    const beforeFloorDraftGoals = goals;
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp"), robot = app.client.robot.worldPosition();
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(robot[0] + 1, app.client.robot.floorWorldY() + 1, robot[2] + 1);
      input.quaternion.set(-Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4));
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.rightController)?.object === app.navigationFloor &&
        app.client.navigation.interaction.snapshot().probes.length > 0;
    })).toBe(true);
    await setSelection(page, 1); await setSelection(page, 0);
    await captureWorld("active-and-preview.png", true);
    await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.navigation.clearAim(); app.client.setRobotSelected(false);
    });
    expect(goals).toBe(beforeFloorDraftGoals);

    // Actual terminal events trace at the goal before reattaching; screenshots and video use normal XR ticks.
    const feedback = () => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      const snap = app.client.navigation.interaction.snapshot();
      return { flash: snap.flash, progress: snap.feedbackProgress, attached: snap.attachedToRobot };
    });
    for (const outcome of ["succeeded", "cancelled"] as const) {
      if (outcome === "cancelled") {
        sendState({ nav: { state: "idle", outcome: null } });
        socket!.send(JSON.stringify({ type: "nav_goal", ts: 20, pose: [1.1, 0.45, 0, 0], path_poses: [[2, 0, 0, 0], [1.1, 0.45, 0, 0]] }) + "\n");
        sendState({ nav: { state: "following_path", outcome: null } });
        await expect.poll(async () => (await feedback()).attached).toBe(false);
      }
      // Trace at normal speed, then hold the built glyph while the screenshot is captured.
      await page.evaluate(() => {
        const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
        const interaction = app.client.navigation.interaction;
        const tick = interaction.tick.bind(interaction);
        interaction.tick = (now: number, delta: number) => tick(now, Math.min(delta, Math.max(0, 0.54 - interaction.snapshot().feedbackProgress * 0.6)));
        w.resumeOutcome = () => { interaction.tick = tick; };
      });
      markVisualReview(page, `navigation-${outcome}.png`);
      sendState({ nav: outcome === "succeeded" ? { state: "resolved", outcome } : { state: "idle", outcome: null } });
      await expect.poll(async () => { const f = await feedback(); return f.flash === outcome && f.progress >= 0.89; }, { intervals: [10] }).toBe(true);
      expect((await feedback()).attached).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`navigation-${outcome}.png`) });
      await page.evaluate(() => (window as any).resumeOutcome());
      await expect.poll(async () => (await feedback()).attached).toBe(true);
    }
    await page.evaluate(q => { (window as any).questDevice.quaternion.set(q[0], q[1], q[2], q[3]); }, beforeFollowingView);

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
    })).toBe("dimOS AR");
    await page.screenshot({ path: testInfo.outputPath("runtime.png") });
    await activateRuntimeButton(page, "Robot selection button");
    await expect.poll(() => ui().then(snap => snap.robotSelected)).toBe(true);
    expect(await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.client.robot.isSelected() && !app.panelHold && app.mainMenu.robotButton.parent === app.mainMenu.robotBadge;
    })).toBe(true);
    await captureMenu(page, testInfo.outputPath("robot-control-menu.png"));
    await activateRuntimeButton(page, "Sensors button");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.mainMenu.sensorsPage.visible;
    })).toBe(true);
    await activateRuntimeButton(page, "Full");
    await expect.poll(async () => (await ui()).lidarMode).toBe("full");
    await captureMenu(page, testInfo.outputPath("sensors.png"));
    await activateRuntimeButton(page, "Obstacles");
    await activateRuntimeButton(page, "Back from Sensors");
    await activateRuntimeButton(page, "Global settings");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.settingsPage.visible;
    })).toBe(true);
    await captureMenu(page, testInfo.outputPath("global-settings.png"));
    await activateRuntimeButton(page, "Diagnostics");
    expect(await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.ui.debugEnabled;
    })).toBe(false);
    await activateRuntimeButton(page, "Done");
    await activateRuntimeButton(page, "Debug · Off");
    await expect.poll(() => ui().then(snap => snap.debugEnabled)).toBe(true);
    await activateRuntimeButton(page, "Debug · On");
    await activateRuntimeButton(page, "Done");
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      app.client.speech.deps.recognition = {
        start: (onText: (text: string, final: boolean) => void, _onError: unknown, _onEnd: unknown, onStarted: () => void) => { w.testTranscript = onText; onStarted(); }, stop() {},
      };
      app.client.speech.deps.synthesis = null;
      app.client.speech.snapshotValue.recognitionAvailable = true;
    });
    await activateRuntimeButton(page, "Agent");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
    })).toBe("Ready");
    expect(agentMessages).toHaveLength(0);
    await pointRuntimeButton(page, "Agent dictation field");
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
    })).toBe("Listening");
    await page.evaluate(() => (window as any).testTranscript("go forward", false));
    expect(agentMessages).toHaveLength(0);
    await captureMenu(page, testInfo.outputPath("agent-recording.png"));
    await setSelection(page, 0);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
    })).toBe("Ready");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.inputLabel.text;
    })).toBe("go forward");
    await captureMenu(page, testInfo.outputPath("agent-draft.png"));
    await activateRuntimeButton(page, "Send to agent");
    await expect.poll(() => agentMessages.at(-1)).toBe("go forward");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.agent.text;
    })).toContain("requested location");
    await captureMenu(page, testInfo.outputPath("agent-control-menu.png"));
    const frontRotation = await page.evaluate(() => {
      const w = window as any;
      const panel = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").mainMenu.panel;
      const saved = panel.quaternion.toArray(); panel.rotateY(Math.PI / 3); return saved;
    });
    await captureMenu(page, testInfo.outputPath("oblique-menu.png"));
    await page.evaluate(q => {
      const w = window as any;
      w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").mainMenu.panel.quaternion.fromArray(q);
    }, frontRotation);


    // Subsequent holds append; Clear empties only the draft.
    for (const words of ["first", "second"]) {
      await pointRuntimeButton(page, "Agent dictation field");
      await setSelection(page, 1);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
      })).toBe("Listening");
      await page.evaluate(words => (window as any).testTranscript(words, true), words);
      await setSelection(page, 0);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
      })).toBe("Ready");
    }
    expect(await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().prompt;
    })).toBe("first second");
    await activateRuntimeButton(page, "Clear");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().prompt;
    })).toBe("");
    expect(agentMessages).toHaveLength(1);

    // Real glyph measurement and real XR drag: complete text stays inside each viewport.
    const longDraft = "Move carefully past the marked doorway and report what you find. ".repeat(25);
    const longReply = "The doorway is clear. I checked the route and found enough clearance to proceed. ".repeat(24);
    await page.evaluate(text => {
      const w = window as any;
      w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.setDraft(text);
    }, longDraft);
    socket!.send(JSON.stringify({ type: "agent_message", text: longReply }) + "\n");
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const menu = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu;
      return menu.inputLabel.maxScroll > 0 && menu.agent.maxScroll > 0;
    })).toBe(true);
    expect(await page.evaluate(() => {
      const w = window as any;
      const menu = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu;
      return [menu.inputLabel.text.length, menu.agent.text.length];
    })).toEqual([longDraft.length, longReply.trim().length]);
    await captureMenu(page, testInfo.outputPath("long-messages.png"));
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const hit = app.mainMenu.inputLabel.scrollHit;
      const p = hit.getWorldPosition(hit.position.clone());
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(p.x, p.y, p.z + 0.4); input.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.rightController)?.object === app.mainMenu.inputLabel.scrollHit;
    })).toBe(true);
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return !!w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").scrollHold;
    })).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.y -= 0.035;
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.mainMenu.inputLabel.scrollOffset > 0 && app.client.speech.snapshot().status !== "Listening";
    })).toBe(true);
    await setSelection(page, 0);
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const hit = app.mainMenu.agent.bodyHit;
      const p = hit.getWorldPosition(hit.position.clone());
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(p.x, p.y, p.z + 0.4); input.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.rightController)?.object === app.mainMenu.agent.bodyHit;
    })).toBe(true);
    if (mode === "controller") {
      await page.evaluate(() => (window as any).questDevice.controllers.right.updateAxis("thumbstick", "y-axis", 1));
    } else {
      await setSelection(page, 1);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        return !!w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").scrollHold;
      })).toBe(true);
      await page.evaluate(() => { (window as any).questDevice.hands.right.position.y += 0.035; });
    }
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.agent.scrollOffset;
    })).toBeGreaterThan(0);
    if (mode === "controller") await page.evaluate(() => (window as any).questDevice.controllers.right.updateAxis("thumbstick", "y-axis", 0));
    else await setSelection(page, 0);
    await captureMenu(page, testInfo.outputPath("scrolled-messages.png"));
    await activateRuntimeButton(page, "Send to agent");
    await expect.poll(() => agentMessages.at(-1)).toBe(longDraft.trim());

    // A second hand cannot dispatch a mode button during dictation, but Stop interrupts once.
    await pointRuntimeButton(page, "Agent dictation field");
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
    })).toBe("Listening");
    const pointLeft = async (name: string) => {
      await page.evaluate(name => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        let button: any;
        app.mainMenu.panel.traverse((node: any) => { if (node.text === name && node.ux) button = node; });
        const p = button.getWorldPosition(button.position.clone());
        const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.left : w.questDevice.hands.left;
        input.position.set(p.x, p.y, p.z + 0.4); input.quaternion.set(0, 0, 0, 1);
        w.leftTarget = button.mesh;
      }, name);
      await expect.poll(() => page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
        return app.interaction.hit(w.xb.core.input.leftController)?.object === w.leftTarget;
      })).toBe(true);
    };
    const pressLeft = async (value: number) => page.evaluate(value => {
      const w = window as any;
      if (w.questDevice.primaryInputMode === "controller") w.questDevice.controllers.left.updateButtonValue("trigger", value);
      else w.questDevice.hands.left.updatePinchValue(value);
    }, value);
    await pointLeft("Manual"); await pressLeft(1); await page.waitForTimeout(80); await pressLeft(0);
    await expect.poll(() => ui().then(snap => snap.operatingMode)).toBe("agent");
    const beforeStop = estops;
    await pointLeft("EMERGENCY STOP"); await pressLeft(1);
    await expect.poll(() => estops).toBe(beforeStop + 1);
    expect(await page.evaluate(() => {
      const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      return app.client.ui.estopPressed && app.client.notifications.object.visible;
    })).toBe(true);
    await page.waitForTimeout(180);
    markVisualReview(page, "emergency-stop.png");
    await page.screenshot({ path: testInfo.outputPath("emergency-stop.png") });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").client.speech.snapshot().status;
    })).not.toBe("Listening");
    await pressLeft(0); await setSelection(page, 0); await page.waitForTimeout(80);
    expect(estops).toBe(beforeStop + 1);
    await activateRuntimeButton(page, "Manual");
    await expect.poll(() => ui().then(snap => snap.operatingMode)).toBe("manual");
    expect((await ui()).robotSelected).toBe(true);
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
    await expect.poll(() => visiblePointerCount(page)).toBeLessThanOrEqual(1);
    await page.evaluate(() => {
      const w = window as any;
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.connected = true;
    });
    await expect.poll(() => page.evaluate(() => { const w = window as any; return w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp").tracking; })).toBe(true);

    // Summoning binds the menu to its source; grabbing explicitly pins it in the world.
    await activateRuntimeButton(page, "Close");
    const orientPalm = async (up: boolean) => page.evaluate(async up => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      await new Promise<void>((resolve, reject) => app.session.requestAnimationFrame((_time: number, frame: XRFrame) => {
        try {
          const source = Array.from(app.session.inputSources as XRInputSource[]).find(source => source.handedness === "left" && source.hand)!;
          const position = (name: XRHandJoint) => {
            const p = frame.getJointPose!(source.hand!.get(name)!, app.reference).transform.position;
            return app.mainMenu.panel.position.clone().set(p.x, p.y, p.z);
          };
          const wrist = position("wrist"), middle = position("middle-finger-metacarpal"), index = position("index-finger-metacarpal"), little = position("pinky-finger-metacarpal");
          const normal = index.sub(little).cross(middle.clone().sub(wrist)).negate().normalize();
          const delta = app.mainMenu.panel.quaternion.clone().setFromUnitVectors(normal, app.mainMenu.panel.position.clone().set(0, up ? 1 : -1, 0));
          const hand = w.questDevice.hands.left;
          const current = app.mainMenu.panel.quaternion.clone().set(hand.quaternion.x, hand.quaternion.y, hand.quaternion.z, hand.quaternion.w);
          const target = delta.multiply(current);
          hand.quaternion.set(target.x, target.y, target.z, target.w);
          resolve();
        } catch (error) { reject(error); }
      }));
    }, up);
    if (mode === "controller") {
      await page.evaluate(() => (window as any).questDevice.controllers.left.updateButtonValue("x-button", 1));
    } else {
      await orientPalm(false); await page.waitForTimeout(400); await orientPalm(true);
    }
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.client.ui.menuOpen ? app.menuAnchor.source?.handedness ?? "pinned" : "closed";
    })).toBe("left");
    if (mode === "controller") await page.evaluate(() => (window as any).questDevice.controllers.left.updateButtonValue("x-button", 0));
    await page.waitForTimeout(250);
    const anchorX = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.left : w.questDevice.hands.left;
      input.position.x += 0.12;
      return app.mainMenu.panel.position.x;
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.x;
    })).toBeGreaterThan(anchorX + 0.10);
    await captureMenu(page, testInfo.outputPath("source-anchored-menu.png"));
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const p = app.mainMenu.barZone.getWorldPosition(app.mainMenu.panel.position.clone());
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.right : w.questDevice.hands.right;
      input.position.set(p.x, p.y, p.z + 0.4); input.quaternion.set(0, 0, 0, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return app.interaction.hit(w.xb.core.input.rightController)?.object === app.mainMenu.barZone;
    })).toBe(true);
    await setSelection(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      return !!app.panelHold && app.menuAnchor.source === null;
    })).toBe(true);
    await setSelection(page, 0);
    const pinned = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      const input = w.questDevice.primaryInputMode === "controller" ? w.questDevice.controllers.left : w.questDevice.hands.left;
      input.position.x += 0.15;
      return app.mainMenu.panel.position.toArray();
    });
    if (mode === "hand") await orientPalm(false);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.toArray();
    })).toEqual(pinned);
    expect((await ui()).menuOpen).toBe(true);

    const initialMenuX = await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      w.questDevice.quaternion.set(0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8));
      return app.mainMenu.panel.position.x;
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp").mainMenu.panel.position.x;
    })).toBeCloseTo(initialMenuX);
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
      return marker.getObjectByName("World marker title").text === "Docking point" && !marker.getObjectByName("World marker circle") && marker.getObjectByName("World marker indicator").position.length() === 0;
    });
    expect(markerParts).toBe(true);
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((object: any) => object.constructor.name === "WebXRApp");
      w.xb.core.scene.background = app.client.robot.collider.material.color.clone().setHex(0x182028);
      document.body.style.background = "#182028";
      document.querySelector("canvas")!.style.background = "#182028";
      w.questDevice.quaternion.set(-Math.sin(0.65 / 2), 0, 0, Math.cos(0.65 / 2));
    });
    await page.waitForTimeout(350);
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
    const fixture = await import("/tests/integration-tests/fixtures/Rendering.ts");
    return fixture.verifyRendering();
  });
  expect(pixels.longEnd[0]).toBeGreaterThan(140);
  expect(pixels.longEnd[0]).toBeLessThan(220);
  expect(pixels.shortEnd.slice(0, 3)).toEqual([0, 0, 0]);
  expect(pixels.regrownEnd).toEqual(pixels.longEnd);
  expect(pixels.opaqueUi.slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels.transparentUi.slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixels.lidarOnly.slice(0, 3)).not.toEqual([255, 255, 255]);
  expect(pixels.lidarOnly.slice(0, 3)).not.toEqual([0, 0, 0]);
  expect(pixels.routeMiddle[0]).toBeGreaterThan(100);
  expect(Math.abs(pixels.routeJoin[0] - pixels.routeMiddle[0])).toBeLessThanOrEqual(1);
  expect(pixels.obstacleNear[0]).toBeGreaterThan(pixels.obstacleMid[0]);
  expect(pixels.obstacleMid[0]).toBeGreaterThan(0);
  expect(pixels.obstacleNear.slice(1, 3)).toEqual([0, 0]);
  expect(pixels.obstacleEdge.slice(0, 3)).toEqual([0, 0, 0]);
});
