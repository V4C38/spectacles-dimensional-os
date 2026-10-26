import { expect, type Page, type WebSocketRoute } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { activateButton } from "./Input";

export const shared = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../tools/integration-tests/scenarios.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export async function bootstrap(
  page: Page,
  mode: "hand" | "controller" = "hand",
  options: { unavailable?: boolean } = {},
) {
  const commands: any[] = [];
  let socket: WebSocketRoute | undefined;
  let captureTs = 0;
  let acceptedCaptureTs = 0;
  const state = (nav = "idle", outcome: string | null = null) =>
    send({
      type: "state",
      server: { connected_clients: 1 },
      lidar: {
        enabled: true,
        min_height_m: 0.1,
        max_height_m: 1.5,
        max_range_m: 5,
      },
      nav: { state: nav, outcome },
      agent: { idle: true },
    });
  const send = (value: object) => {
    if (!socket) throw new Error("Fixture WebSocket is not connected");
    socket.send(JSON.stringify(value) + "\n");
  };
  await page.addInitScript({
    path: fileURLToPath(
      new URL("../../../node_modules/iwer/build/iwer.js", import.meta.url),
    ),
  });
  await page.addInitScript((mode) => {
    const w = window as any;
    w.questDevice = new w.IWER.XRDevice(w.IWER.metaQuest3);
    w.questDevice.primaryInputMode = mode;
    w.questDevice.installRuntime({ forceInstall: true });
  }, mode);
  await page.routeWebSocket("**/ar", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      if (typeof raw !== "string") {
        const packet = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        let offset = 6;
        for (let i = 0; i < packet.getUint16(4, true); i++) {
          captureTs = Math.max(captureTs, packet.getFloat64(offset + 4, true));
          offset += 4 + packet.getUint32(offset, true);
        }
        return;
      }
      const command = JSON.parse(raw);
      commands.push(command);
      const available = {
        available: !options.unavailable,
        reason: options.unavailable
          ? "Unavailable in integration fixture"
          : null,
      };
      if (command.type === "hello_request") {
        send({
          type: "hello",
          client_id: "integration",
          time_sync: {
            ts_client: command.ts_client,
            ts_server: command.ts_client,
          },
          server_info: {
            robot_ip: "192.168.1.42",
            dimos_version: "0.4.0",
            armodule_version: "0.2.0",
          },
          robot: shared.fixtures.robot,
          capabilities: {
            lidar: available,
            localization: available,
            estop: available,
            agent: available,
            navigation: {
              ...available,
              nav_goal: { ...available, preview: true },
              nav_joystick: available,
            },
          },
        });
        state();
        send({
          type: "pose",
          position: shared.fixtures.pose,
          orientation: [0, 0, 0, 1],
          ts: command.ts_client,
        });
      }
      if (command.type === "localization_start_request")
        send({
          type: "localization_observations_request",
          capture_policy: "robot_los_required",
          observation_count: 1,
        });
      if (command.type === "user_message_request")
        send({ type: "agent_message", text: shared.fixtures.response });
      if (command.type === "nav_goal_request") {
        const [x, y, z] = command.position;
        send({
          type: "nav_goal",
          preview: !!command.preview,
          ...(command.preview ? { preview_id: command.preview_id } : {}),
          pose: [x, y, z, 0],
          path_poses: [
            [2, 0, 0, 0],
            [2.5, y / 2, 0, 0],
            [x, y, z, 0],
          ],
          ts: performance.now(),
        });
        if (!command.preview) state("following_path");
      }
      if (command.type === "estop_request") state("idle");
    });
  });
  await page.goto("/?debug=1");
  await page.selectOption("#hmd", mode === "hand" ? "quest3s" : "quest3");
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
    const camera = app.client.camera;
    const track = {
      label: "camera 1, facing back",
      stop() {},
      getSettings: () => ({
        width: 1280,
        height: 960,
        frameRate: 30,
        facingMode: "environment",
        deviceId: "test-left",
      }),
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    camera.media = {
      getUserMedia: async () => stream,
      enumerateDevices: async () => [
        { kind: "videoinput", label: track.label, deviceId: "test-left" },
      ],
    };
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 960;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#505762";
    ctx.fillRect(0, 0, 1280, 960);
    ctx.fillStyle = "white";
    ctx.fillRect(520, 360, 240, 240);
    ctx.fillStyle = "black";
    ctx.fillRect(540, 380, 200, 200);
    ctx.fillStyle = "white";
    ctx.fillRect(570, 410, 50, 110);
    ctx.fillRect(650, 470, 60, 70);
    camera.previewFrame = () => ({ video: canvas, width: 1280, height: 960 });
    camera.videoFactory = () => ({
      play: async () => {},
      pause() {},
      srcObject: null,
    });
    camera.jpeg = {
      encode: async () => ({
        jpeg: new Uint8Array([255, 216, 255, 217]),
        width: 1280,
        height: 960,
      }),
    };
    let timer: ReturnType<typeof setInterval>;
    camera.frames = {
      start: (_: any, onFrame: any) => {
        timer = setInterval(
          () => onFrame({}, { captureTime: performance.now() }),
          30,
        );
      },
      stop: () => clearInterval(timer),
    };
    app.client.speech.deps.recognition = {
      start: (onText: any, onError: any, onEnd: any, onStarted: any) => {
        w.integrationTranscript = onText;
        w.integrationRecognitionError = onError;
        w.integrationRecognitionEnd = onEnd;
        onStarted();
      },
      stop() {},
      finish() {
        w.integrationRecognitionEnd?.();
      },
    };
    app.client.speech.deps.synthesis = null;
    app.client.speech.snapshotValue.recognitionAvailable = true;
  });
  await page.locator("#enter").click();
  await expect(page.locator("#enter")).toHaveText("Enter AR");
  await page.locator("#enter").click();
  await expect
    .poll(() => snapshot(page).then((s) => s?.wizardStep))
    .toBe("connect");
  await expect
    .poll(() => snapshot(page).then((s) => s.wizardCardTitle))
    .toBe("Connected to dimOS ARModule");
  await page.evaluate(async () => {
    const session = (window as any).xb.core.renderer.xr.getSession();
    await new Promise<void>((resolve) =>
      session.requestAnimationFrame(() =>
        session.requestAnimationFrame(() => resolve()),
      ),
    );
  });
  const completeLocalization = async () => {
    await expect.poll(() => captureTs).toBeGreaterThan(acceptedCaptureTs);
    acceptedCaptureTs = captureTs;
    send({
      type: "localization_result",
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      confidence: 1,
      ts: captureTs,
    });
  };
  const localized = async () => {
    await activateButton(page);
    await completeLocalization();
    await expect
      .poll(() =>
        snapshot(page).then((s) => s.setupCompleted && !s.setupCelebrating),
      )
      .toBe(true);
  };
  const lidar = () => {
    const count = 480,
      data = Buffer.alloc(16 + count * 12);
    data.writeUInt32LE(0x4c444152, 0);
    data.writeDoubleLE(Date.now() / 1000, 4);
    data.writeUInt32LE(count, 12);
    for (let i = 0; i < count; i++) {
      data.writeFloatLE(1.5 + (i % 20) / 10, 16 + i * 12);
      data.writeFloatLE(-1 + Math.floor(i / 20) / 12, 20 + i * 12);
      data.writeFloatLE(0.1 + (i % 12) / 10, 24 + i * 12);
    }
    socket!.send(data);
  };
  return {
    send,
    state,
    commands,
    localized,
    completeLocalization,
    lidar,
    close: () => socket?.close(),
  };
}
export async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() =>
    (window as any).xb.core.scene.children
      .find((o: any) => o.constructor.name === "WebXRApp")
      .client.ui.snapshot(),
  );
}
