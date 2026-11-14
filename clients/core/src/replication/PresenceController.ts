import type { PresenceCues, PresencePanel, PresencePointer, PresenceState, ReadonlyFacts, Vec3, Quat } from "../ClientContracts";
import { clientTrackingToOdomPoint, clientTrackingToOdomPose, odomToClientTrackingPoint, odomToClientTrackingPose, lerpVec3, slerpQuat, type ClientTrackingOriginStore } from "../localization/ClientTracking";

export const PRESENCE_INTERVAL_S = 0.2;
export const PRESENCE_STALE_S = 2;
const EMPTY: PresenceCues = { pointers: [], panel: null };
type Remote = { client_id: string; cues: PresenceCues };
interface PresencePort { ready(): boolean; clientId(): string | null; now(): number; send(text: string): void; }

/** One owner for optional, passive cues. Hosts supply final rendered geometry in tracking metres. */
export class PresenceController {
  private sampledAt = -Infinity;
  private sentAt = -Infinity;
  private sent = "";
  private receivedAt = -Infinity;
  private context = "";
  private remote = new Map<string, { from: PresenceCues; to: ReadonlyFacts<PresenceCues>; at: number; expires: number }>();
  constructor(private readonly port: PresencePort, private readonly origins: ClientTrackingOriginStore) {}

  reset(): void { this.sampledAt = this.sentAt = this.receivedAt = -Infinity; this.sent = this.context = ""; this.remote.clear(); }
  publish(read: () => PresenceCues, active = true): void {
    const now = this.port.now();
    if (!this.port.ready() || now - this.sampledAt < PRESENCE_INTERVAL_S - 1e-6) return;
    this.sampledAt = now;
    const origin = this.origins.T_odom_client, context = this.origins.mapContext;
    if (!context) return;
    const cues = active && origin ? transformCues(read(), p => clientTrackingToOdomPoint(p, origin),
      p => clientTrackingToOdomPose(p, origin)) : EMPTY;
    const text = JSON.stringify({ type: "client_presence", ...context, ...roundCues(cues) }) + "\n";
    if (text === this.sent && (cues.pointers.length === 0 && !cues.panel || now - this.sentAt < 1)) return;
    this.port.send(text); this.sent = text; this.sentAt = now;
  }
  apply(state: ReadonlyFacts<PresenceState>): void {
    const now = this.port.now();
    if (!this.origins.acceptsContext(state)) { this.remote.clear(); return; }
    const context = JSON.stringify([state.map_code, state.odom_reference_id]);
    if (context !== this.context) this.remote.clear();
    this.context = context; this.receivedAt = now;
    const seen = new Set<string>();
    for (const client of state.clients) {
      if (client.client_id === this.port.clientId() || client.age_s >= PRESENCE_STALE_S) continue;
      seen.add(client.client_id);
      const prior = this.remote.get(client.client_id);
      this.remote.set(client.client_id, { from: prior ? interpolate(prior.from, prior.to, (now - prior.at) / PRESENCE_INTERVAL_S) : copyCues(client),
        to: client, at: now, expires: now + PRESENCE_STALE_S - client.age_s });
    }
    for (const id of this.remote.keys()) if (!seen.has(id)) this.remote.delete(id);
  }
  snapshot(): Remote[] {
    const origin = this.origins.T_odom_client, context = this.origins.mapContext, now = this.port.now();
    if (!this.port.ready() || !origin || !context || this.context !== JSON.stringify([context.map_code, context.odom_reference_id]) || now - this.receivedAt >= PRESENCE_STALE_S) return [];
    const result: Remote[] = [];
    for (const [client_id, value] of this.remote) {
      if (now >= value.expires) { this.remote.delete(client_id); continue; }
      result.push({ client_id, cues: transformCues(interpolate(value.from, value.to, (now - value.at) / PRESENCE_INTERVAL_S),
        p => odomToClientTrackingPoint(p, origin), p => odomToClientTrackingPose(p, origin)) });
    }
    return result;
  }
}

function transformCues(cues: ReadonlyFacts<PresenceCues>, point: (p: Readonly<Vec3>) => Vec3,
  pose: (p: ReadonlyFacts<PresencePanel>) => { position: Vec3; orientation: Quat }): PresenceCues {
  return { pointers: cues.pointers.map(p => ({ ...p, start: point(p.start), control: point(p.control), end: point(p.end) })),
    panel: cues.panel ? { ...cues.panel, ...pose(cues.panel) } : null };
}
function copyCues(cues: ReadonlyFacts<PresenceCues>): PresenceCues {
  return transformCues(cues, p => [...p], p => ({ position: [...p.position], orientation: [...p.orientation] }));
}
function roundCues(cues: PresenceCues): PresenceCues {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const result = transformCues(cues, p => p.map(round) as Vec3,
    p => ({ position: p.position.map(round) as Vec3, orientation: p.orientation.map(v => Math.round(v * 10000) / 10000) as Quat }));
  if (result.panel) { result.panel.width = round(result.panel.width); result.panel.height = round(result.panel.height); }
  for (const p of result.pointers) p.opacity = Math.round(p.opacity * 100) / 100;
  return result;
}
function interpolate(from: ReadonlyFacts<PresenceCues>, to: ReadonlyFacts<PresenceCues>, t: number): PresenceCues {
  t = Math.max(0, Math.min(1, t));
  return { pointers: to.pointers.map(p => {
    const old = from.pointers.find(v => v.id === p.id);
    return { ...p, start: old ? lerpVec3(old.start, p.start, t) : [...p.start],
      control: old ? lerpVec3(old.control, p.control, t) : [...p.control], end: old ? lerpVec3(old.end, p.end, t) : [...p.end] };
  }), panel: to.panel ? { ...to.panel, position: from.panel ? lerpVec3(from.panel.position, to.panel.position, t) : [...to.panel.position],
    orientation: from.panel ? slerpQuat(from.panel.orientation, to.panel.orientation, t) : [...to.panel.orientation],
    width: from.panel ? from.panel.width + (to.panel.width - from.panel.width) * t : to.panel.width,
    height: from.panel ? from.panel.height + (to.panel.height - from.panel.height) * t : to.panel.height } : null };
}

/** Strictly bounded optional telemetry, isolated from critical control decoding. */
export function decodePresenceState(data: Record<string, unknown>): PresenceState {
  const string = (value: unknown): string => { if (typeof value !== "string" || !value.length || value.length > 128) throw new Error("Invalid presence identity"); return value; };
  const number = (value: unknown, min: number, max: number): number => { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid presence number"); return value; };
  const vector = (value: unknown, n: number): number[] => { if (!Array.isArray(value) || value.length !== n) throw new Error("Invalid presence vector"); return value.map(v => number(v, -1e6, 1e6)); };
  const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid presence object"); return value as Record<string, unknown>; };
  const boolean = (value: unknown): boolean => { if (typeof value !== "boolean") throw new Error("Invalid presence boolean"); return value; };
  if (!Array.isArray(data.clients) || data.clients.length > 16) throw new Error("Invalid presence clients");
  const clients = data.clients.map(value => {
    const c = object(value);
    if (!Array.isArray(c.pointers) || c.pointers.length > 2) throw new Error("Invalid presence pointers");
    const pointers: PresencePointer[] = c.pointers.map(value => { const p = object(value); const id = number(p.id, 0, 1); if (!Number.isInteger(id)) throw new Error("Invalid pointer slot");
      return { id, start: vector(p.start, 3) as Vec3, control: vector(p.control, 3) as Vec3, end: vector(p.end, 3) as Vec3, opacity: number(p.opacity, 0, 1), cursor: boolean(p.cursor) }; });
    if (new Set(pointers.map(p => p.id)).size !== pointers.length) throw new Error("Duplicate pointer slot");
    let panel: PresencePanel | null = null;
    if (c.panel !== null) { const p = object(c.panel); const q = vector(p.orientation, 4) as Quat;
      const norm = Math.hypot(...q); if (norm < 1e-6) throw new Error("Invalid panel rotation");
      panel = { position: vector(p.position, 3) as Vec3, orientation: q.map(v => v / norm) as Quat, width: number(p.width, .001, 10), height: number(p.height, .001, 10) }; }
    return { client_id: string(c.client_id), age_s: number(c.age_s, 0, 2), pointers, panel };
  });
  if (new Set(clients.map(c => c.client_id)).size !== clients.length) throw new Error("Duplicate presence client");
  return { type: "presence_state", map_code: string(data.map_code), odom_reference_id: string(data.odom_reference_id), clients };
}
