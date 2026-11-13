import { validPin } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/connectionPin";
import { isValidHost } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/hostNormalization";
// Looks up a six-digit PIN on the IP relay and returns the LAN address.

export const IP_RELAY_URL = "https://spectacles-ip-relay.johannestscharn.workers.dev";

export type ConnectionMethod = "pin" | "ip";

export interface ResolvedPin {
  ip: string;
  port: number;
}

export function toggleConnectionMethod(method: ConnectionMethod): ConnectionMethod {
  return method === "pin" ? "ip" : "pin";
}

export function routeConnectionField(
  method: ConnectionMethod,
  field: string,
): { kind: "pin"; pin: string } | { kind: "ip"; host: string } | null {
  const text = field.trim();
  if (method === "pin") {
    return validPin(text) ? { kind: "pin", pin: text } : null;
  }
  return text.length > 0 ? { kind: "ip", host: text } : null;
}

export class IpRelayClient {
  private readonly relayUrl: string;
  private pendingLookup: { pin: string; result: Promise<ResolvedPin | null> } | null = null;

  constructor(
    private internetModule: InternetModule,
    relayUrl: string = IP_RELAY_URL,
  ) {
    this.relayUrl = relayUrl.replace(/\/$/, "");
  }

  resolve(pin: string): Promise<ResolvedPin | null> {
    // Native fetch has no portable cancellation API. Never accumulate outstanding requests
    // if a platform request stalls past the UI/connection discovery deadline.
    if (this.pendingLookup) {
      return this.pendingLookup.pin === pin ? this.pendingLookup.result : Promise.resolve(null);
    }
    const request = new Request(this.relayUrl + "/v1/pins/" + pin, { method: "GET" });
    const result = this.internetModule
      .fetch(request)
      .then((response: Response) => {
        if (response.status !== 200) {
          return null;
        }
        return response.text().then((raw: string) => {
          const body = JSON.parse(raw) as { ip?: unknown; port?: unknown };
          if (!body || typeof body.ip !== "string" || typeof body.port !== "number" || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535 || !isValidHost(body.ip)) {
            return null;
          }
          return { ip: body.ip, port: body.port };
        });
      })
      .catch(() => null)
      .finally(() => { this.pendingLookup = null; });
    this.pendingLookup = { pin, result };
    return result;
  }
}
