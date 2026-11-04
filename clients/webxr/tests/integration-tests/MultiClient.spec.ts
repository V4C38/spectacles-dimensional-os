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
  const python = process.env.CI_VENV ? `${process.env.CI_VENV}/bin/python`
    : process.env.DIMOS_PYTHON ?? "/tmp/spectacles-dimensional-os-ci-venv/bin/python";
  server = spawn(python, [fileURLToPath(new URL("./fixtures/multi_client_server.py", import.meta.url))], {
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

async function connect(page: Page, shift: number, renderEnabled = true) {
  page.on("pageerror", error => console.error("Multi-client page:", error.message));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  // Loopback is the real shared server; no page-local authoritative fixtures.
  await page.route("**/multi-client-test", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>Shared ARModule integration</title></head><body></body></html>",
  }));
  await page.goto("/multi-client-test");
  await page.evaluate(async ({ coreUrl, shift, port, renderEnabled }) => {
    const { ARModuleSession } = await import(`${coreUrl}/websocket/arModuleSession.ts`);
    const { ClientTrackingOriginStore } = await import(`${coreUrl}/localization/clientTrackingOrigin.ts`);
    const { BrowserWebSocketTransport } = await import("/src/websocket/BrowserWebSocketTransport.ts");
    const { WebXRNavigationController } = await import("/src/navigation/WebXRNavigationController.ts");
    const THREE = await import("/node_modules/three/build/three.module.js");
    const origin = new ClientTrackingOriginStore();
    const clock = { now: () => performance.now() / 1000 };
    const transport = new BrowserWebSocketTransport({ url: `ws://127.0.0.1:${port}/` });
    const sent: object[] = [], sendText = transport.sendText.bind(transport);
    transport.sendText = (value: string) => { sent.push(JSON.parse(value)); sendText(value); };
    const session = new ARModuleSession({ transport, clock, clientTrackingOriginStore: origin });
    transport.bind({ onTransportOpen: () => session.onTransportOpen(), onTransportClose: () => session.onTransportClose(),
      onTransportText: (value: string) => session.onTransportText(value), onTransportBinary: (value: Uint8Array) => session.onTransportBinary(value) });
    const nav = new WebXRNavigationController(session);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x182028);
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
    const timer = setInterval(() => { session.tick(); nav.tick(clock.now(), 1 / 60); if (renderEnabled) renderer.render(scene, camera); }, 1000 / 60);
    (window as any).multi = { session, nav, timer, clock, origin, sent };
    session.start();
  }, { coreUrl, shift, port, renderEnabled });
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
      const observer = await extra[i].newPage(); observers.push(observer); await connect(observer, i + 2, false);
    }
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
