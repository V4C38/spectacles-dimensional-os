import { createServer as createViteServer, preview as vitePreview } from "vite";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import type { Socket } from "node:net";
import { PinGateway, validDestination, pinGatewayPlugin } from "../server/PinGateway";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); });
async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(() => { server.closeAllConnections(); server.close(); });
  return (server.address() as { port: number }).port;
}
async function fixture(resolve: (pin: string) => Promise<unknown>) {
  const gateway = new PinGateway(resolve, value => {
    const target = value as { ip?: string; port?: number } | null;
    return target?.ip === "127.0.0.1" && typeof target.port === "number";
  });
  const server = createServer((req, res) => { void gateway.request(req, res, () => { res.writeHead(404).end(); }); });
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket as Socket, head));
  const port = await listen(server);
  cleanups.push(() => gateway.close());
  return { port, gateway, join: async (pin: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/connections`, { method: "POST", body: JSON.stringify({ pin }) });
    return { status: res.status, body: await res.json() as { controlUrl: string; bulkUrl: string } };
  } };
}
async function backend(label: string) {
  const server = createServer();
  const ws = new WebSocketServer({ server });
  ws.on("connection", (socket, req) => { socket.on("message", (message, binary) => socket.send(binary ? message : `${label}:${req.url}:${message}`, { binary })); });
  const port = await listen(server);
  cleanups.push(() => { for (const client of ws.clients) client.terminate(); ws.close(); });
  return { ip: "127.0.0.1", port };
}
async function connect(port: number, path: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  cleanups.push(() => socket.terminate());
  await once(socket, "open"); return socket;
}
async function echo(socket: WebSocket, text: string) {
  const response = once(socket, "message"); socket.send(text); return String((await response)[0]);
}

describe("PIN gateway", () => {
  it("accepts only usable private IPv4 addresses and integer ports", () => {
    expect(validDestination({ ip: "192.168.1.4", port: 8787 })).toBe(true);
    for (const ip of ["127.0.0.1", "010.0.0.1", "169.254.1.2", "8.8.8.8", "192.168.999.1", "localhost", "10.1.1.1/path"]) {
      expect(validDestination({ ip, port: 8787 })).toBe(false);
    }
    expect(validDestination({ ip: "10.1.1.1", port: 0 })).toBe(false);
    expect(validDestination({ ip: "10.1.1.1", port: 1.5 })).toBe(false);
  });

  it("routes concurrent reusable PIN joins and both raw channels to immutable destinations", async () => {
    const a = await backend("A"), b = await backend("B");
    const resolve = vi.fn(async (pin: string) => pin === "001234" ? a : b);
    const { port, join } = await fixture(resolve);
    const routes = await Promise.all([join("001234"), join("654321"), join("001234")]);
    expect(routes.map(r => r.status)).toEqual([200, 200, 200]);
    expect(routes[0].body.controlUrl).not.toEqual(routes[2].body.controlUrl);
    const sockets = await Promise.all(routes.map(r => connect(port, r.body.controlUrl)));
    const bulks = await Promise.all(routes.map(r => connect(port, r.body.bulkUrl)));
    expect(await Promise.all(sockets.map(s => echo(s, "control")))).toEqual(["A:/:control", "B:/:control", "A:/:control"]);
    expect(await Promise.all(bulks.map(s => echo(s, "bulk")))).toEqual(["A:/bulk:bulk", "B:/bulk:bulk", "A:/bulk:bulk"]);
    expect(resolve).toHaveBeenCalledTimes(3);
    const closed = once(bulks[0], "close"); sockets[0].close(); await closed;
    expect(await echo(sockets[1], "still-live")).toBe("B:/:still-live");
  });

  it("keeps binary bulk independent, permits bulk reconnect and rejects duplicate sockets", async () => {
    const destination = await backend("A");
    const { port, join, gateway } = await fixture(async () => destination);
    const route = await join("000001");
    const control = await connect(port, route.body.controlUrl);
    const bulk = await connect(port, route.body.bulkUrl);
    const destroy = vi.fn();
    for (const url of [route.body.controlUrl, route.body.bulkUrl]) {
      gateway.upgrade({ url, headers: {} } as never, { destroy } as never, Buffer.alloc(0));
    }
    expect(destroy).toHaveBeenCalledTimes(2);
    const payload = Buffer.alloc(2 * 1024 * 1024, 37);
    const received = once(bulk, "message");
    bulk.send(payload);
    expect(await echo(control, "responsive")).toBe("A:/:responsive");
    const [binary, isBinary] = await received;
    expect(isBinary).toBe(true);
    expect(Buffer.compare(binary as Buffer, payload)).toBe(0);
    const closed = once(bulk, "close"); bulk.close(); await closed;
    const reconnected = await connect(port, route.body.bulkUrl);
    expect(await echo(reconnected, "again")).toBe("A:/bulk:again");
    expect(await echo(control, "after-reconnect")).toBe("A:/:after-reconnect");
  });

  it("rejects forged routes and bulk before control without consuming the route", async () => {
    const destination = await backend("A");
    const { port, join, gateway } = await fixture(async () => destination);
    const route = await join("000001");
    const destroy = vi.fn();
    gateway.upgrade({ url: route.body.bulkUrl, headers: {} } as never, { destroy } as never, Buffer.alloc(0));
    gateway.upgrade({ url: `/api/connections/${"f".repeat(48)}/control`, headers: {} } as never, { destroy } as never, Buffer.alloc(0));
    expect(destroy).toHaveBeenCalledTimes(2);
    const control = await connect(port, route.body.controlUrl);
    expect(await echo(control, "ok")).toBe("A:/:ok");
    const denied = await fetch(`http://127.0.0.1:${port}/api/connections`, {
      method: "POST", headers: { origin: "https://other.example" }, body: JSON.stringify({ pin: "000001" }),
    });
    expect(denied.status).toBe(403);
  });

  it.each(["dev", "preview"])("isolates gateway paths from Vite legacy proxies in %s", async mode => {
    const intended = await backend("selected"), legacy = await backend("wrong-localhost");
    const root = await mkdtemp(joinPath(tmpdir(), "pin-gateway-vite-"));
    cleanups.push(() => { void rm(root, { recursive: true, force: true }); });
    await mkdir(joinPath(root, "dist"));
    await writeFile(joinPath(root, "dist", "index.html"), "<!doctype html><title>gateway fixture</title>");
    const options = {
      configFile: false as const, root, plugins: [pinGatewayPlugin(() => new PinGateway(async () => intended,
        target => (target as { ip: string }).ip === "127.0.0.1"))],
      server: { host: "127.0.0.1", port: 0, proxy: { "/bulk": { target: `ws://127.0.0.1:${legacy.port}`, ws: true } } },
      preview: { host: "127.0.0.1", port: 0, proxy: { "/bulk": { target: `ws://127.0.0.1:${legacy.port}`, ws: true } } },
    };
    const vite = mode === "dev" ? await createViteServer(options) : await vitePreview(options);
    if ("listen" in vite) await vite.listen();
    cleanups.push(() => { void vite.close(); });
    const port = (vite.httpServer!.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/connections`, { method: "POST", body: JSON.stringify({ pin: "001234" }) });
    expect(response.status).toBe(200);
    const route = await response.json() as { controlUrl: string; bulkUrl: string };
    const control = await connect(port, route.controlUrl);
    const bulk = await connect(port, route.bulkUrl);
    expect(await echo(control, "control")).toBe("selected:/:control");
    expect(await echo(bulk, "bulk")).toBe("selected:/bulk:bulk");
    expect(await echo(await connect(port, "/bulk"), "legacy")).toBe("wrong-localhost:/bulk:legacy");
  });

  it("retires a pending lookup on shutdown and fences its late result", async () => {
    let resolveLookup!: (value: unknown) => void;
    const lookup = new Promise(resolve => { resolveLookup = resolve; });
    const { gateway, join } = await fixture(async () => lookup);
    const pending = join("001234").catch(() => null);
    await vi.waitFor(() => expect((gateway as any).pending).toBe(1));
    gateway.close();
    resolveLookup({ ip: "127.0.0.1", port: 8787 });
    await pending;
    expect((gateway as any).routes.size).toBe(0);
    await vi.waitFor(() => expect((gateway as any).pending).toBe(0));
  });

  it("rejects invalid PINs without lookup and expires unused routes", async () => {
    const resolve = vi.fn(async () => ({ ip: "127.0.0.1", port: 8787 }));
    const { gateway, join } = await fixture(resolve);
    expect((await join("123")).status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
    const route = await join("000001");
    vi.useFakeTimers(); vi.advanceTimersByTime(31000);
    const destroy = vi.fn();
    gateway.upgrade({ url: route.body.controlUrl, headers: {} } as never, { destroy } as never, Buffer.alloc(0));
    expect(destroy).toHaveBeenCalledOnce();
  });
});
