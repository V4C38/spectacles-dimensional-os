import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request } from "node:https";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import type { Socket } from "node:net";
import { WebSocket } from "ws";
import { PinGateway } from "../../server/PinGateway";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
let processHandle: ChildProcess | undefined;
let log = "";
let backendPort = 0;

test.beforeAll(async () => {
  const python = process.env.DIMOS_PYTHON || (process.env.CI_VENV ? `${process.env.CI_VENV}/bin/python` : "python3");
  processHandle = spawn(python, [fileURLToPath(new URL("./fixtures/multi_client_server.py", import.meta.url))], {
    cwd: `${root}dimos-ar`, env: { ...process.env, PYTHONPATH: `${root}dimos-ar` }, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`ARModule startup timed out: ${log}`)), 20000);
    const read = (chunk: Buffer) => {
      log += chunk.toString();
      const match = /MULTI_CLIENT_READY=(\d+)/.exec(log);
      if (match) { backendPort = Number(match[1]); clearTimeout(timeout); resolve(); }
    };
    processHandle!.stdout!.on("data", read); processHandle!.stderr!.on("data", read);
    processHandle!.once("error", error => { clearTimeout(timeout); reject(error); });
    processHandle!.once("exit", code => { clearTimeout(timeout); reject(new Error(`ARModule exited ${code}: ${log}`)); });
  });
});

test.afterAll(async () => {
  if (!processHandle || processHandle.exitCode !== null) return;
  const exited = once(processHandle, "exit");
  processHandle.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
  clearTimeout(timer!);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
});

async function record(socket: WebSocket, type: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off("message", receive); reject(new Error(`Missing ${type}`)); }, 5000);
    const receive = (data: Buffer) => {
      for (const line of data.toString().trim().split("\n")) {
        const value = JSON.parse(line);
        if (value.type === type) { clearTimeout(timeout); socket.off("message", receive); resolve(value); }
      }
    };
    socket.on("message", receive);
  });
}

test("HTTPS PIN gateway pairs independent v3 control and bulk sessions with real ARModule", async ({}, info) => {
  const gateway = new PinGateway(async pin => pin === "001234" ? { ip: "127.0.0.1", port: backendPort } : null,
    value => (value as { ip?: string } | null)?.ip === "127.0.0.1");
  // Playwright's production Vite webServer has already generated its development certificate.
  const certificate = await readFile(`${root}clients/webxr/node_modules/.vite/basic-ssl/_cert.pem`);
  const server = createServer({ key: certificate, cert: certificate }, (req, res) => {
    void gateway.request(req, res, () => { res.writeHead(404).end(); });
  });
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket as Socket, head));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  async function socket(path: string) {
    const ws = new WebSocket(`wss://127.0.0.1:${port}${path}`, { rejectUnauthorized: false });
    sockets.push(ws); await once(ws, "open"); return ws;
  }
  async function join() {
    return new Promise<{ controlUrl: string; bulkUrl: string }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/api/connections", method: "POST", rejectUnauthorized: false }, res => {
        let text = ""; res.on("data", chunk => { text += chunk.toString(); });
        res.on("end", () => { try { expect(res.statusCode).toBe(200); resolve(JSON.parse(text)); } catch (error) { reject(error); } });
      });
      req.on("error", reject); req.end(JSON.stringify({ pin: "001234" }));
    });
  }
  try {
    const routes = await Promise.all([join(), join()]);
    const hello = await Promise.all(routes.map(async route => {
      const control = await socket(route.controlUrl);
      const result = record(control, "hello");
      control.send(JSON.stringify({ type: "hello_request", protocol_version: 3, ts_client: 1 }));
      return result;
    }));
    expect(hello[0].client_id).not.toEqual(hello[1].client_id);
    expect(hello[0].bulk_epoch).toEqual(hello[1].bulk_epoch);
    const bulk = await Promise.all(routes.map(async (route, index) => {
      const channel = await socket(route.bulkUrl);
      const ready = record(channel, "bulk_hello");
      channel.send(JSON.stringify({ type: "bulk_hello_request", protocol_version: 3, client_id: hello[index].client_id, token: hello[index].bulk_token }));
      return ready;
    }));
    for (let i = 0; i < bulk.length; i++) {
      expect(bulk[i].protocol_version).toBe(3);
      expect(bulk[i].epoch).toBe(hello[i].bulk_epoch);
    }
    await info.attach("gateway-v3-pairing", { body: JSON.stringify({ clientIds: hello.map(value => value.client_id), bulkEpochs: bulk.map(value => value.epoch), boundary: "Real HTTPS gateway and ARModule; injected PIN directory and simulated robot ports" }), contentType: "application/json" });
  } finally {
    for (const ws of sockets) ws.terminate(); gateway.close(); server.closeAllConnections(); server.close();
    await info.attach("armodule-server", { body: log, contentType: "text/plain" });
  }
});
