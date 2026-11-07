import { validPin, type ResolvedConnection } from "@dimos-ar-client/websocket/ConnectionResolution";

/** The gateway owns relay lookup; the browser retains its secure same-origin sockets. */
export async function resolvePinConnection(
  pin: string,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedConnection> {
  if (!validPin(pin)) throw new Error("Enter a 6-digit PIN");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetcher(new URL("/api/connections", origin), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }), signal: controller.signal,
    });
    const body = await response.json() as { controlUrl?: unknown; bulkUrl?: unknown; error?: unknown };
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "PIN did not resolve");
    const route = /^\/api\/connections\/([A-Za-z0-9_-]+)\/(control|bulk)$/;
    if (typeof body.controlUrl !== "string" || typeof body.bulkUrl !== "string") throw new Error("Invalid connection response");
    const control = route.exec(body.controlUrl); const bulk = route.exec(body.bulkUrl);
    if (!control || !bulk || control[1] !== bulk[1] || control[2] !== "control" || bulk[2] !== "bulk") throw new Error("Invalid connection route");
    const base = new URL(origin);
    if (base.protocol !== "https:") throw new Error("WebXR requires HTTPS");
    base.protocol = "wss:";
    return { controlUrl: new URL(body.controlUrl, base).toString(), bulkUrl: new URL(body.bulkUrl, base).toString() };
  } finally { clearTimeout(timeout); }
}
