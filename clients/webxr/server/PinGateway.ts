import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import httpProxy from "http-proxy";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

const RELAY = "https://spectacles-ip-relay.johannestscharn.workers.dev";
interface Destination { ip: string; port: number }
interface Route { target: string; expires: number; control: Socket | null; bulk: Socket | null }

export function validDestination(value: unknown): value is Destination {
  if (!value || typeof value !== "object") return false;
  const { ip, port } = value as Destination;
  if (typeof ip !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
    || !Number.isInteger(port) || port < 1 || port > 65535) return false;
  const parts = ip.split(".").map(Number);
  if (parts.join(".") !== ip || parts.some(p => p > 255)) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168
    || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export class PinGateway {
  private readonly routes = new Map<string, Route>();
  private pending = 0;
  private readonly pendingResponses = new Set<ServerResponse>();
  private closed = false;
  private readonly closeAbort = new AbortController();
  private readonly bodyRequests = new Set<IncomingMessage>();
  private readonly proxy = httpProxy.createProxyServer({ ws: true });
  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(private readonly resolve: (pin: string) => Promise<unknown> = async pin => {
    const response = await fetch(`${RELAY}/v1/pins/${pin}`, {
      signal: AbortSignal.any([this.closeAbort.signal, AbortSignal.timeout(8000)]), redirect: "error",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("PIN lookup unavailable");
    return response.json();
  }, private readonly destinationPolicy: (value: unknown) => boolean = validDestination) {
    this.proxy.on("proxyReqWs", (request, _incoming, socket) => {
      const cancel = () => request.destroy();
      socket.once("close", cancel);
      request.setTimeout(8000, cancel);
      request.once("close", () => socket.removeListener("close", cancel));
      request.once("upgrade", (_response, upstream) => {
        socket.removeListener("close", cancel); upstream.setTimeout(0);
      });
    });
    this.proxy.on("error", (_error, _request, response) => {
      if ("destroy" in response) response.destroy();
    });
    this.sweep = setInterval(() => this.prune(), 5000);
    this.sweep.unref();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, route] of this.routes) {
      if (!route.control && route.expires <= now) this.routes.delete(id);
    }
  }

  async request(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    if (req.url?.split("?")[0] !== "/api/connections") { next(); return; }
    const reply = (status: number, body: object) => {
      if (!res.destroyed) {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
      }
    };
    if (this.closed) { reply(503, { error: "Gateway stopped" }); return; }
    if (req.method !== "POST") { reply(405, { error: "Use POST" }); return; }
    // No cross-origin browser access to the LAN gateway.
    if (req.headers.origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* invalid origin */ }
      if (!sameOrigin) { reply(403, { error: "Origin rejected" }); return; }
    }
    this.prune();
    if (this.routes.size + this.pending >= 256 || this.pending >= 16) {
      reply(503, { error: "Connection capacity reached" }); return;
    }
    this.pending++; this.pendingResponses.add(res);
    this.bodyRequests.add(req);
    const bodyDeadline = setTimeout(() => req.destroy(), 8000);
    bodyDeadline.unref();
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 256) { reply(413, { error: "Request too large" }); return; }
      }
      let pin: unknown;
      try { pin = JSON.parse(body).pin; } catch { reply(400, { error: "Invalid request" }); return; }
      if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
        reply(400, { error: "Enter a 6-digit PIN" }); return;
      }
      clearTimeout(bodyDeadline);
      this.bodyRequests.delete(req);
      const destination = await this.resolve(pin);
      if (!this.destinationPolicy(destination) || !destination || typeof destination !== "object") { reply(404, { error: "PIN did not resolve" }); return; }
      if (this.closed || res.destroyed) return;
      const id = randomBytes(24).toString("hex");
      this.routes.set(id, { target: `ws://${(destination as Destination).ip}:${(destination as Destination).port}`, expires: Date.now() + 30000, control: null, bulk: null });
      reply(200, { controlUrl: `/api/connections/${id}/control`, bulkUrl: `/api/connections/${id}/bulk` });
    } catch { reply(503, { error: "PIN lookup unavailable" }); }
    finally { clearTimeout(bodyDeadline); this.bodyRequests.delete(req); this.pendingResponses.delete(res); this.pending--; }
  }

  upgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!req.url?.startsWith("/api/connections/")) return;
    const match = /^\/api\/connections\/([a-f0-9]{48})\/(control|bulk)$/.exec(req.url);
    this.prune();
    const route = match && this.routes.get(match[1]);
    if (!match || !route) { socket.destroy(); return; }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    // Keep the original request namespace intact for Vite's other upgrade listeners.
    const upstreamRequest = Object.create(req) as IncomingMessage;
    if (match[2] === "control") {
      if (route.control) { socket.destroy(); return; }
      route.control = socket;
      socket.once("close", () => {
        this.routes.delete(match[1]); route.bulk?.destroy();
      });
      upstreamRequest.url = "/";
    } else {
      if (!route.control || route.control.destroyed || route.bulk) { socket.destroy(); return; }
      route.bulk = socket;
      socket.once("close", () => { if (route.bulk === socket) route.bulk = null; });
      upstreamRequest.url = "/bulk";
    }
    // Established socket streams retain their normal backpressure; no frame buffering here.
    this.proxy.ws(upstreamRequest, socket, head, { target: route.target });
  }

  close(): void {
    this.closed = true; this.closeAbort.abort();
    for (const req of this.bodyRequests) req.destroy();
    this.bodyRequests.clear();
    for (const response of this.pendingResponses) response.destroy();
    this.pendingResponses.clear();
    clearInterval(this.sweep);
    for (const route of this.routes.values()) { route.control?.destroy(); route.bulk?.destroy(); }
    this.routes.clear();
    this.proxy.close();
  }
}

export function pinGatewayPlugin(createGateway: () => PinGateway = () => new PinGateway()): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    const gateway = createGateway();
    server.middlewares.use((req, res, next) => { void gateway.request(req, res, next); });
    server.httpServer?.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket as Socket, head));
    server.httpServer?.once("close", () => gateway.close());
  };
  return { name: "dimos-pin-gateway", configureServer: install, configurePreviewServer: install };
}
