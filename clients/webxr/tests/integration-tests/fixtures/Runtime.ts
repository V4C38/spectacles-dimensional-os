import { V2BulkPeer } from "./V2BulkPeer";
import { expect, type Page, type WebSocketRoute } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { activateButton } from "./Input";
import { InteractionPeer } from "./InteractionPeer";

export function isNavigationCommit(command: { type: string; preview?: boolean; action?: string }): boolean {
  return command.type === "nav_goal_request" && !command.preview
    || command.type === "interaction_request" && command.action === "confirm";
}

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
  options: { unavailable?: boolean; manipulation?: boolean; planDelayMs?: number; evaluationDelayMs?: number; planJointDelta?: number; armIntervalMs?: number; armReference?: string; independentIK?: boolean; interactionDelayMs?: number; evaluationTargetScale?: number } = {},
) {
  const commands: any[] = [];
  const bulk = new V2BulkPeer(); await bulk.install(page);
  const arm = options.manipulation ? JSON.parse(readFileSync(new URL("./OpenYAM.json", import.meta.url), "utf8")) : null;
  let armTimer: ReturnType<typeof setInterval> | undefined;
  let armClockBase = 0, armClockStarted = 0;
  const armNow = () => armClockBase + (performance.now() - armClockStarted) / 1000;
  let following = false, plan: any = null, owner: string | null = null;
  let followingTail: any = null, validatedTarget: any = null;
  let execution = "idle", operationId: string | null = null, settledAt: number | null = null;
  let armStopped = false;
  let feedbackPaused = false;
  let ikFailure: { code: string; failed_joints?: string[] } | null = null;
  let planSequence = 0;
  const delayedReplies: ReturnType<typeof setTimeout>[] = [];
  const armState = () => {
    if (!arm) return;
    if (feedbackPaused) { send({type:"manipulation_state",available:false,message:"Waiting for arm feedback"}); return; }
    if (followingTail) {
      for (const [joint, value] of Object.entries(followingTail.joints as Record<string, number>))
        arm.joints[joint] += (value - arm.joints[joint]) * 0.5;
      arm.pose = { position: followingTail.position, orientation: followingTail.orientation };
      const arrived = Object.entries(followingTail.joints as Record<string, number>).every(([joint, value]) => Math.abs(arm.joints[joint] - value) < 0.02);
      if (arrived) settledAt ??= armNow(); else settledAt = null;
      if (settledAt !== null && armNow() - settledAt >= 0.5) followingTail = null;
    }
    send({ type: "manipulation_state", available: true, ts: armNow(), root_pose: { position: [1,0,0.8], orientation: [0,0,0,1] }, model: arm.model,
      groups: [{ id: "manipulator", joint_names: Object.keys(arm.joints), base_frame: "base", tip_frame: "gripper_tip", has_gripper: true, following: true }],
      observations: { manipulator: { joints: arm.joints, measured_at: armNow(), pose: arm.pose, gripper: 0 } },
      execution, message: null, owner, following, following_tail: followingTail,
      stopped: armStopped, stop_confirmed: true, plan, operation_id: operationId });
  };
  let socket: WebSocketRoute | undefined;
  const peer = new InteractionPeer("fixture-epoch", "integration");
  const interactionState = () => send(peer.snapshot({
    following_tail: followingTail, motion_busy: operationId !== null,
  }));
  let captureTs = 0;
  let acceptedCaptureTs = 0;
  let lidarSettings = {
    enabled: false, min_height_m: 0.1, max_height_m: 1.5, max_range_m: 5,
  };
  let navigation = { state: "idle", outcome: null as string | null };
  const state = (nav?: string, outcome: string | null = null) => {
    if (nav !== undefined) navigation = { state: nav, outcome };
    send({
      type: "state",
      server: { connected_clients: 1 },
      lidar: { ...lidarSettings },
      nav: { ...navigation },
      agent: { idle: true },
    });
  };
  const send = (value: object) => {
    if (!socket) throw new Error("Fixture WebSocket is not connected");
    if (options.interactionDelayMs && (value as { type?: string }).type === "interaction_state") {
      const snapshot = structuredClone(value);
      delayedReplies.push(setTimeout(() => { if (socket) bulk.send(socket, snapshot); }, options.interactionDelayMs));
      return;
    }
    bulk.send(socket, value);
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
    if (armTimer) clearInterval(armTimer);
    socket = ws;
    const onMessage = (raw: string | Buffer) => {
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
      const mobile = arm ? { available: false, reason: "Stationary arm" } : available;
      if (command.type === "hello_request") {
        armClockBase = command.ts_client; armClockStarted = performance.now();
        send({
          type: "hello", protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch",
          client_id: "integration",
          ...(options.independentIK ? { independent_ik: true } : {}),
          ...(options.armReference ? {odom_reference_id:options.armReference} : {}),
          time_sync: {
            ts_client: command.ts_client,
            ts_server: command.ts_client,
          },
          server_info: {
            robot_ip: "192.168.1.42",
            dimos_version: "0.4.0",
            armodule_version: "0.2.0",
          },
          robot: arm ? {...shared.fixtures.robot,display_name:"OpenYAM"} : shared.fixtures.robot,
          capabilities: {
            ...(options.manipulation ? { manipulation: {available: true, reason: null} } : {}),
            lidar: mobile,
            localization: available,
            estop: available,
            agent: mobile,
            navigation: {
              ...mobile,
              nav_goal: { ...mobile, preview: !arm },
              nav_joystick: mobile,
            },
          },
        });
        state();
        if (options.manipulation) { armState(); armTimer = setInterval(armState, options.armIntervalMs ?? 100); armTimer.unref(); }
        interactionState();

        send({
          type: "pose",
          position: shared.fixtures.pose,
          orientation: [0, 0, 0, 1],
          ts: command.ts_client,
        });
      }
      if (command.type === "interaction_request") {
        const result = peer.accept(command, operationId !== null);
        if (result.acquired) { followingTail = null; settledAt = null; following = false; owner = null; }
        const released = result.released;
        if (released) {
          if (released.kind === "manipulation_following" && following && validatedTarget) {
            followingTail = { generation: peer.revision + 1, group_id: released.target?.group_id ?? validatedTarget.group_id,
              target_revision: validatedTarget.target_revision, status: "finishing",
              position: validatedTarget.position, orientation: validatedTarget.orientation,
              speed_scale: validatedTarget.speed_scale, joints: validatedTarget.joints };
            following = false; owner = null; settledAt = null;
          }
          if (released.target?.domain === "navigation" && released.kind !== "joystick") {
            const [x, y, z] = released.target.position;
            peer.activeGoal = { type: "nav_goal", pose: [x, y, z, 0], path_poses: [[2,0,0,0],[2.5,y/2,0,0],[x,y,z,0]], ts: performance.now() };
            send(peer.activeGoal); state("following_path");
          }
          if (arm) armState();
        }
        interactionState();
        send(peer.result(command, result));
      }
      if (command.type === "state_request") state();
      if (command.type === "lidar_settings_request" && !options.unavailable) {
        lidarSettings = {
          enabled: command.enabled,
          min_height_m: command.min_height_m,
          max_height_m: command.max_height_m,
          max_range_m: command.max_range_m,
        };
        state();
      }
      if (command.type === "localization_start_request")
        send({
          type: "localization_observations_request", capture_id: "fixture-capture",
          capture_policy: "robot_los_required",
          observation_count: 1,
        });
      if (command.type === "user_message_request")
        send({ type: "agent_message", text: shared.fixtures.response });
      if (command.type === "nav_goal_request") {
        const [x, y, z] = command.position;
        const frame = {
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
        };
        send(frame);
        if (command.preview) { peer.preview = frame; peer.previewAim = { position: [...command.position], orientation: [...command.orientation] }; interactionState(); }
        else { peer.activeGoal = frame; interactionState(); }
        if (!command.preview) state("following_path");
      }
      if (command.type === "estop_request") {
        peer.authority = null; peer.preview = peer.previewAim = null; peer.activeGoal = null;
        following = false; followingTail = null; owner = null; plan = null; operationId = null;
        armStopped = true; execution = "aborted"; state("idle"); interactionState(); armState();
      }
      if (command.type === "manipulation_request" && arm) {
        let result: any = {status: "completed"};
        if (command.action === "evaluate") result = {status: "feasible", joints: {...arm.joints,
          yam_joint2: arm.joints.yam_joint2 + 0.2 + (options.evaluationTargetScale ?? 0) * (command.position[2] - arm.pose.position[2]) },
          pose: command, sample_pose: { position: command.position, orientation: command.orientation } };
        if (command.action === "plan") {
          plan = {plan_id: `fixture-plan-${++planSequence}`, joint_names: Object.keys(arm.joints), duration: 2,
            trajectory: [{time: 0, positions: Object.values(arm.joints)}, {time: 2, positions: Object.values(arm.joints).map((v: any, i) => i === 1 ? v + (options.planJointDelta ?? 0.2) : v)}]};
          plan.target_revision = command.target_revision;
          result = {status: "planned", ...plan};
        }
        if (command.action === "execute") {
          const accepted = command.plan_id === plan?.plan_id && command.target_revision === peer.target?.revision && plan?.target_revision === peer.target?.revision;
          result = { status: accepted ? "accepted" : "rejected", operation_id: accepted ? "fixture-operation" : null };
          if (accepted) {
            execution = "executing"; operationId = "fixture-operation";
            delayedReplies.push(setTimeout(() => {
              plan?.joint_names.forEach((name: string, i: number) => { arm.joints[name] = plan.trajectory.at(-1).positions[i]; });
              execution = "completed"; operationId = null; plan = null; armState(); interactionState();
            }, 1000));
          }
        }
        if (command.action === "resume") { armStopped = false; execution = "idle"; result = {status: "resumed"}; }
        if (command.action === "acquire") { followingTail = null; validatedTarget = null; following = true; owner = "integration"; result = {status: "acquired", token: "fixture-follow"}; }
        if (command.action === "release" || command.action === "cancel") { following = false; followingTail = null; owner = null; plan = null; operationId = null; execution = "idle"; if (command.action === "release") result = {status: "released"}; }
        if (command.action === "update") {
          result = {status:"feasible", sequence:command.sequence, joints:{...arm.joints,yam_joint6:arm.joints.yam_joint6+0.8}};
          if (!ikFailure) {
            arm.pose = { position: command.position, orientation: command.orientation };
            validatedTarget = { ...command, joints: result.joints };
          }
        }
        if (ikFailure && ["update", "evaluate", "plan"].includes(command.action)) {
          result = { status: "infeasible", message: "Pink IK did not converge within the iteration budget", ...ikFailure,
            ...(command.action === "update" ? { sequence: command.sequence } : {}) };
        }
        const reply = {type: "manipulation_result", request_id: command.request_id, action: command.action, group_id: command.group_id, ...result};
        const delay=command.action === "plan" ? options.planDelayMs : command.action === "evaluate" ? options.evaluationDelayMs : 0;
        if (delay) delayedReplies.push(setTimeout(()=>send(reply),delay));
        else send(reply);
        armState();
      }
    };
    ws.onMessage(onMessage); bulk.onUpload = onMessage;
  });
  if (process.env.INTEGRATION_PRODUCTION === "1") {
    await page.route("**/node_modules/three/build/*.js", route => {
      const name = new URL(route.request().url()).pathname.split("/").pop()!;
      return route.fulfill({path: fileURLToPath(new URL(`../../../node_modules/three/build/${name}`, import.meta.url)), contentType: "application/javascript"});
    });
  }
  await page.goto("/?debug=1&connection=local");
  await page.selectOption("#hmd", mode === "hand" ? "quest3s" : "quest3");
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
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
    bulk.lidar(data);
  };
  return {
    setArmExecution: (status: string) => { execution = status; operationId = status === "executing" ? "fixture-busy" : null; armState(); interactionState(); },
    setArmJoint: (name: string, value: number, publishImmediately = true) => { arm.joints[name] = value; if (publishImmediately) armState(); },
    send,
    setIKFailure: (failure: typeof ikFailure) => { ikFailure = failure; },
    pauseArmFeedback: (paused: boolean) => { feedbackPaused=paused; armState(); },
    dropArmConnection: () => {
      if(armTimer) clearInterval(armTimer);
      armStopped=true; following=false; owner=null; plan=null;
      peer.authority=null; followingTail=null; operationId=null;
      socket?.close({code:1012,reason:"Fixture transport interruption"});
    },
    state,
    commands,
    get joystickStops() { return peer.joystickStops; },
    localized,
    completeLocalization,
    lidar,
    close: () => { delayedReplies.forEach(clearTimeout); if (armTimer) clearInterval(armTimer); socket?.close(); },
  };
}
export async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() =>
    (window as any).xb.core.scene.children
      .find((o: any) => o.client?.manipulation)
      .client.ui.snapshot(),
  );
}
