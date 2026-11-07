import { expect, test, type Page } from "@playwright/test";
import { saveCaseProof } from "./fixtures/CaseProof";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const coreUrl = `/@fs${root}clients/specs/Assets/Scripts/DimOSARClient`;
let server: ChildProcess;
let port = 0;
let serverLog = "";

test.afterEach(async ({}, info) => {
  if (info.status !== "passed") console.error(serverLog);
  await info.attach("armodule-server", { body: serverLog, contentType: "text/plain" });
  await saveCaseProof(info, ["multi_client_replication"], [], {
    multi_client_replication: ["single_planner", "shared_target", "observer_grey_cross", "handover", "owner_disconnect"],
  });
});

test.beforeAll(async () => {
  const python = process.env.DIMOS_PYTHON || (process.env.CI_VENV
    ? `${process.env.CI_VENV}/bin/python` : "python3");
  server = spawn(python, [fileURLToPath(new URL("./fixtures/multi_client_server.py", import.meta.url)), "--manipulation"], {
    cwd: `${root}dimos-ar`, env: { ...process.env, PYTHONPATH: `${root}dimos-ar` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ARModule startup timed out: ${serverLog}`)), 20000);
    const onData = (chunk: Buffer) => {
      serverLog += chunk.toString();
      const ready = serverLog.match(/MULTI_CLIENT_READY=(\d+)/);
      if (ready) { port = Number(ready[1]); clearTimeout(timer); resolve(); }
    };
    server.stdout!.on("data", onData); server.stderr!.on("data", onData);
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`ARModule exited ${code}: ${serverLog}`)); });
  });
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
});

async function connect(page: Page, shift: number, renderEnabled = true, specs = false, manipulation = false) {
  page.on("pageerror", error => console.error("Multi-client page:", error.message));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  // Loopback is the real shared server; no page-local authoritative fixtures.
  await page.route("**/multi-client-test", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>Shared ARModule integration</title></head><body></body></html>",
  }));
  await page.goto("/multi-client-test");
  await page.evaluate(async ({ coreUrl, shift, port, renderEnabled, specs, manipulation }) => {
    const { ARModuleSession } = await import(`${coreUrl}/websocket/arModuleSession.ts`);
    const { ClientTrackingOriginStore } = await import(`${coreUrl}/localization/clientTrackingOrigin.ts`);
    const { BrowserWebSocketTransport } = await import("/src/websocket/BrowserWebSocketTransport.ts");
    const { WebXRNavigationController } = await import("/src/navigation/WebXRNavigationController.ts");
    const THREE = await import("/node_modules/three/build/three.module.js");
    const origin = new ClientTrackingOriginStore();
    const clock = { now: () => performance.now() / 1000 };
    const { specsTransport } = await import("/tests/integration-tests/fixtures/SpecsTransportHost.ts");
    const transport = specs ? specsTransport(`ws://127.0.0.1:${port}/`)
      : new BrowserWebSocketTransport({ url: `ws://127.0.0.1:${port}/` });
    const sent: object[] = [], sendText = transport.sendText.bind(transport);
    transport.sendText = (value: string) => { sent.push(JSON.parse(value)); sendText(value); };
    const session = new ARModuleSession({ transport, clock, clientTrackingOriginStore: origin });
    transport.bind({ onTransportOpen: () => session.onTransportOpen(), onTransportClose: () => session.onTransportClose(),
      onTransportText: (value: string) => session.onTransportText(value), onTransportBinary: (value: Uint8Array) => session.onTransportBinary(value) });
    const nav = new WebXRNavigationController(session);
    const { WebXRManipulationController } = await import("/src/manipulation/WebXRManipulationController.ts");
    const arm = manipulation ? new WebXRManipulationController(session, () => origin.T_odom_client, () => clock.now()) : null;
    const results: object[] = []; session.subscribeOutbound((message: { type: string }) => { if (message.type === "manipulation_result") results.push(message); });
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x182028);
    if (arm) scene.add(arm.object);
    scene.add(nav.marker.object, nav.draftMarker.object, nav.probeRoot);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(800, 600);
    document.body.replaceChildren(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.01, 100);
    camera.position.set(3, 3, 3); camera.lookAt(0, 0, -2);
    session.subscribeView(() => {
      if (session.view().connection === "ready" && !origin.hasTrackingOrigin)
        origin.restore({ position: [shift, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 });
      nav.applyView(session.view(), origin.T_odom_client, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, clock.now());
    });
    const timer = setInterval(() => { session.tick(); nav.tick(clock.now(), 1 / 60); arm?.tick(true); if (renderEnabled) renderer.render(scene, camera); }, 1000 / 60);
    (window as any).multi = { host: specs ? "specs" : "webxr", session, nav, arm, timer, clock, origin, sent, results };
    session.start();
  }, { coreUrl, shift, port, renderEnabled, specs, manipulation });
  await expect.poll(() => page.evaluate(() => {
    const view = (window as any).multi.session.view();
    return view.lastError ?? view.connection;
  })).toBe("ready");
  await expect.poll(() => page.evaluate(() => !!(window as any).multi.session.view().interaction)).toBe(true);
}

async function state(page: Page) {
  return page.evaluate(() => {
    const { session, nav } = (window as any).multi;
    return { raw: session.view().interaction, clientId: session.view().hello?.client_id,
      error: session.view().lastError, diagnostics: session.diagnostics(), connectedClients: session.view().state?.server.connected_clients,
      marker: nav.interaction.snapshot(), cross: nav.draftMarker.object.getObjectByName("Navigation blocked cross").visible };
  });
}

test("one selected planner replicates a smooth shared draft, confirms, and hands over", async ({ browser }, info) => {
  test.setTimeout(60000);
  const first = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await browser.newContext({ ignoreHTTPSErrors: true });
  await first.grantPermissions(["local-network-access"]);
  await second.grantPermissions(["local-network-access"]);
  const a = await first.newPage(), b = await second.newPage();
  const extra = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ ignoreHTTPSErrors: true })));
  const observers: Page[] = [];
  try {
    await connect(a, 0); await connect(b, 1);
    for (let i = 0; i < extra.length; i++) {
      await extra[i].grantPermissions(["local-network-access"]);
      const observer = await extra[i].newPage(); observers.push(observer); await connect(observer, i + 2, false, i === 0);
    }
    expect(await observers[0].evaluate(() => (window as any).multi.host)).toBe("specs");
    await expect.poll(async () => (await state(a)).connectedClients).toBe(5);
    expect(new Set(await Promise.all([a,b,...observers].map(async page => (await state(page)).clientId))).size).toBe(5);
    const aid = (await state(a)).clientId;
    expect(aid).not.toBe((await state(b)).clientId);
    await a.evaluate(() => {
      const { nav, clock } = (window as any).multi;
      nav.setSelected(true);
      nav.interaction.hold(clock.now(), { position: [2, 0, 0], blocked: false }, false, "right");
    });
    await expect.poll(async () => (await state(b)).raw.authority?.client_id).toBe(aid);
    await expect.poll(async () => (await state(b)).marker.draft?.position[0]).toBeCloseTo(1);
    expect(await a.evaluate(() => {
      const { nav, clock } = (window as any).multi;
      nav.interaction.aim(clock.now(), { position: [3, 0, 0], blocked: false }, "right");
      return nav.interaction.snapshot().draft.position[0];
    })).toBe(3);
    await expect.poll(async () => (await state(b)).marker.draft?.position[0]).toBeCloseTo(2);
    await a.evaluate(() => {
      const { nav, clock } = (window as any).multi;
      nav.interaction.release(clock.now(), { position: [3, 0, 0], blocked: false }, "right");
    });
    await expect.poll(async () => (await state(b)).raw.authority?.held).toBe(false);
    await expect.poll(async () => (await state(b)).marker.blocked).toBe(true);
    for (const observer of observers) await expect.poll(async () => (await state(observer)).marker.blocked).toBe(true);
    await expect.poll(async () => (await state(b)).cross).toBe(true);
    await expect.poll(async () => (await state(b)).raw.preview?.path_poses?.length).toBe(2);
    expect(await b.evaluate(() => {
      const { nav, clock } = (window as any).multi;
      nav.setSelected(true);
      return nav.interaction.hold(clock.now(), { position: [8, 0, 0], blocked: false }, false, "left");
    })).toBe(false);
    await a.screenshot({ path: info.outputPath("01-owner-preview.png") });
    await b.screenshot({ path: info.outputPath("02-multi_client_replication.png") });
    await a.evaluate(() => {
      const { nav, clock } = (window as any).multi;
      nav.interaction.hold(clock.now(), { position: [3, 0, 0], blocked: false }, false, "right");
      nav.interaction.release(clock.now(), { position: [3, 0, 0], blocked: false }, "right");
    });
    await expect.poll(async () => {
      const value = await state(b);
      if (!value.raw) throw new Error(`Observer session failed: ${value.error}`);
      return value.raw.authority;
    }).toBeNull();
    await expect.poll(async () => (await state(b)).raw.active_goal?.pose?.[0]).toBe(3);
    expect((await state(a)).raw.target.position).toEqual((await state(b)).raw.target.position);
    await b.evaluate(() => {
      const { nav, clock } = (window as any).multi;
      nav.interaction.hold(clock.now(), { position: [2, 0, 0], blocked: false }, false, "left");
    });
    await expect.poll(async () => (await state(a)).raw.authority?.client_id).toBe((await state(b)).clientId);
    await b.evaluate(() => (window as any).multi.session.stop());
    await expect.poll(async () => (await state(a)).raw.authority).toBeNull();
  } catch (error) {
    const debug = await a.evaluate(() => {
      const { session, nav, sent } = (window as any).multi;
      return { view: session.view(), marker: nav.interaction.snapshot(), sent };
    });
    await info.attach("owner-state", { body: JSON.stringify(debug, null, 2), contentType: "application/json" });
    throw error;
  } finally { await first.close(); await second.close(); for (const context of extra) await context.close(); }
});

async function armState(page: Page) {
  return page.evaluate(() => {
    const { session, arm, results, sent } = (window as any).multi;
    return { client: session.view().hello?.client_id, shared: session.view().interaction,
      native: session.view().manipulation, intent: arm.interaction.snapshot(),
      target: arm.interaction.target, joints: arm.interaction.previewJoints,
      rayDisabled: arm.renderer.handle.collider.userData.rayDisabled,
      results, sent };
  });
}

async function connectArm(page: Page, shift = 0, specs = false) {
  await connect(page, shift, false, specs, true);
  await expect.poll(async () => (await armState(page)).native?.available).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).multi.arm.interaction.groupId)).toBe("arm");
  if ((await armState(page)).native.stopped) {
    await page.evaluate(() => (window as any).multi.arm.interaction.resume());
    await expect.poll(async () => (await armState(page)).native.stopped).toBe(false);
  }
}

async function grabArm(page: Page, x: number, selected = false) {
  expect(await page.evaluate(selected => {
    const { arm } = (window as any).multi;
    arm.setSelected(selected); return arm.interaction.begin();
  }, selected)).toBe(true);
  const client = (await armState(page)).client;
  await expect.poll(async () => (await armState(page)).shared.authority?.client_id).toBe(client);
  await page.evaluate(x => (window as any).multi.arm.interaction.aim({ position: [x, 0, 0], orientation: [0, 0, 0, 1] }), x);
  await expect.poll(async () => (await armState(page)).joints?.slide).toBeCloseTo(x);
}

async function armContext(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.grantPermissions(["local-network-access"]);
  return context;
}

test("arm following replicates to late joiners, excludes observers and allows takeover after release", async ({ browser }) => {
  test.setTimeout(60000);
  const ca = await armContext(browser), cb = await armContext(browser), cc = await armContext(browser);
  const a = await ca.newPage(), b = await cb.newPage(), c = await cc.newPage();
  try {
    await connectArm(a); await connectArm(b, 1, true);
    await grabArm(a, 0.6);
    await expect.poll(async () => (await armState(b)).target?.position[0]).toBeCloseTo(0.6);
    expect((await armState(b)).intent.blocked).toBe(true);
    expect((await armState(b)).rayDisabled).toBe(true);
    expect(await b.evaluate(() => (window as any).multi.arm.interaction.begin())).toBe(false);
    await connectArm(c, 2);
    await expect.poll(async () => (await armState(c)).target?.position[0]).toBeCloseTo(0.6);
    expect((await armState(c)).intent.blocked).toBe(true);
    const owner = await armState(a);
    const token = owner.results.find((r: any) => r.type === "manipulation_result" && r.action === "acquire" && r.token).token;
    const forged = { type: "manipulation_request", request_id: "forged-observer", action: "acquire", group_id: "arm",
      epoch: owner.shared.epoch, lease_id: owner.shared.authority.lease_id, sequence: 1000 };
    await b.evaluate(command => (window as any).multi.session.sendText(JSON.stringify(command)), forged);
    await expect.poll(async () => (await armState(b)).results.find((r: any) => r.request_id === "forged-observer")?.code).toBe("ownership");
    await a.evaluate(() => (window as any).multi.arm.interaction.end());
    await expect.poll(async () => (await armState(b)).shared.authority).toBeNull();
    await expect.poll(async () => (await armState(b)).native.following_tail?.position[0]).toBeCloseTo(0.6);
    await grabArm(b, 0.9);
    const bid = (await armState(b)).client;
    const stale = { ...forged, request_id: "stale-owner", action: "update", token, sequence: 999,
      ts: 0, position: [-1, 0, 0], orientation: [0, 0, 0, 1], speed_scale: 0.5 };
    await a.evaluate(command => (window as any).multi.session.sendText(JSON.stringify(command)), stale);
    await expect.poll(async () => (await armState(a)).results.find((r: any) => r.request_id === "stale-owner")?.code).toBe("ownership");
    await ca.close();
    await expect.poll(async () => (await armState(c)).shared.authority?.client_id).toBe(bid);
    await expect.poll(async () => (await armState(c)).target?.position[0]).toBeCloseTo(0.9);
    expect((await armState(b)).native.stopped).toBe(false);
    await b.evaluate(() => {
      const { arm } = (window as any).multi;
      arm.interaction.setSpeedScale(0.7); arm.interaction.setGripper(1);
    });
    await expect.poll(async () => (await armState(c)).shared.target?.speed_scale).toBe(0.7);
    await expect.poll(async () => (await armState(c)).shared.target?.gripper).toBe(1);
    await expect.poll(async () => (await armState(c)).native.observations.arm.gripper).toBe(1);
    await b.evaluate(() => (window as any).multi.arm.interaction.end());
    await expect.poll(async () => (await armState(c)).native.following_tail).toBeNull();
    await expect.poll(async () => (await armState(c)).native.observations.arm.joints.slide).toBeCloseTo(0.9);
    expect((await armState(c)).native.stopped).toBe(false);
    await grabArm(b, -0.2);
    await cb.close();
    await expect.poll(async () => (await armState(c)).native.stopped).toBe(true);
    await expect.poll(async () => (await armState(c)).native.following).toBe(false);
    await expect.poll(async () => (await armState(c)).shared.authority).toBeNull();
  } finally { await ca.close(); await cb.close(); await cc.close(); }
});

test("a replicated selected arm plan can be executed by another client after editing release", async ({ browser }) => {
  test.setTimeout(60000);
  const ca = await armContext(browser), cb = await armContext(browser), cc = await armContext(browser);
  const a = await ca.newPage(), b = await cb.newPage(), c = await cc.newPage();
  try {
    await connectArm(a); await connectArm(b, 1, true);
    await grabArm(a, 0.3, true);
    await expect.poll(async () => (await armState(b)).target?.position[0]).toBeCloseTo(0.3);
    expect(await b.evaluate(() => (window as any).multi.arm.interaction.begin())).toBe(false);
    await expect.poll(async () => (await armState(b)).joints?.slide).toBeCloseTo(0.3);
    expect((await armState(b)).native.plan).toBeNull();
    for (const x of [0.45, 0.3]) {
      await a.evaluate(x => (window as any).multi.arm.interaction.aim({ position: [x, 0, 0], orientation: [0, 0, 0, 1] }), x);
      await expect.poll(async () => (await armState(b)).joints?.slide).toBeCloseTo(x);
    }
    await connectArm(c, 2);
    await expect.poll(async () => (await armState(c)).joints?.slide).toBeCloseTo(0.3);
    expect((await armState(c)).intent.blocked).toBe(true);
    await a.evaluate(() => (window as any).multi.arm.interaction.end());
    await expect.poll(async () => (await armState(b)).native.plan?.trajectory?.length).toBe(2);
    await expect.poll(async () => (await armState(b)).shared.authority).toBeNull();
    const plan = (await armState(b)).native.plan;
    await expect.poll(async () => (await armState(c)).native.plan?.plan_id).toBe(plan.plan_id);
    await b.evaluate(() => (window as any).multi.arm.setSelected(true));
    await expect.poll(async () => (await armState(b)).intent.canExecute).toBe(true);
    await b.evaluate(() => (window as any).multi.arm.interaction.execute());
    await expect.poll(async () => (await armState(b)).results.some((r: any) => r.action === "execute" && r.status === "accepted")).toBe(true);
    await ca.close();
    await expect.poll(async () => (await armState(c)).native.execution).toBe("completed");
    await expect.poll(async () => (await armState(c)).native.observations.arm.joints.slide).toBeCloseTo(0.3);
    expect((await armState(c)).native.stopped).toBe(false);
  } catch (error) {
    console.error(JSON.stringify({ a: await armState(a), b: await armState(b) }));
    throw error;
  } finally { await ca.close(); await cb.close(); await cc.close(); }
});
