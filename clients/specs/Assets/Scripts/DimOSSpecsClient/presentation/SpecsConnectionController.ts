import type { ARModuleSession } from "../../DimOSARClient/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "../../DimOSARClient/websocket/hostPorts";
import { buildModuleWebSocketUrl, isValidHost, saveModuleHost, type ModuleHostStore } from "../../DimOSARClient/websocket/hostNormalization";
import { routeConnectionField, type ConnectionMethod, type ResolvedPin } from "../IpRelayClient";

const PIN_STORAGE_KEY = "dimos_ar_module_pin";

export interface SpecsConnectionDependencies {
  script: Pick<ScriptComponent, "createEvent" | "removeEvent">;
  session: Pick<ARModuleSession, "view" | "start" | "stop">;
  transport: { setUrl(url: string): void };
  hostStore: ModuleHostStore;
  ipRelayClient: { resolve(pin: string): Promise<ResolvedPin | null> };
  onChanged(): void;
}

/** Owns connection attempts; session tick remains the sole socket reconnect owner. */
export class SpecsConnectionController {
  private generation = 0;
  private disposed = false;
  private started = false;
  private connecting = false;
  private resolving = false;
  private error: string | null = null;
  private retry: (() => void) | null = null;
  private polling = false;
  private readonly retryEvent: DelayedCallbackEvent;
  private readonly pollEvent: DelayedCallbackEvent;

  constructor(private readonly deps: SpecsConnectionDependencies) {
    this.retryEvent = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.retryEvent.bind(() => { if (!this.disposed) this.retry?.(); });
    this.pollEvent = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.pollEvent.bind(() => this.poll());
  }

  snapshot(): Readonly<{ connecting: boolean; resolvingPin: boolean; error: string | null }> {
    return { connecting: this.connecting, resolvingPin: this.resolving, error: this.error };
  }

  storedPin(): string {
    const store = this.deps.hostStore;
    const routed = store.has(PIN_STORAGE_KEY) ? routeConnectionField("pin", store.getString(PIN_STORAGE_KEY)) : null;
    return routed?.kind === "pin" ? routed.pin : "";
  }

  start(method: ConnectionMethod, field: string): void {
    if (this.disposed) return;
    this.cancel();
    const generation = this.generation;
    const routed = routeConnectionField(method, field);
    if (!routed || routed.kind === "ip" && !isValidHost(routed.host)) {
      this.error = method === "pin" ? "Enter a 6-digit PIN" : "Enter a valid IP address";
      this.changed(); return;
    }
    this.connecting = true;
    if (routed.kind === "pin") {
      this.deps.hostStore.putString(PIN_STORAGE_KEY, routed.pin);
      this.resolving = true;
      this.changed();
      void this.resolve(routed.pin, generation);
    } else {
      this.changed();
      this.connect(routed.host, AR_MODULE_CLIENT_CONFIG.port, generation, () => this.start(method, field));
    }
  }

  cancel(disconnect = false): void {
    this.generation++;
    this.retryEvent.cancel(); this.pollEvent.cancel();
    this.retry = null; this.polling = false;
    this.connecting = false; this.resolving = false; this.error = null;
    if (disconnect) { this.deps.session.stop(); this.started = false; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.deps.script.removeEvent(this.retryEvent); this.deps.script.removeEvent(this.pollEvent);
  }

  private changed(): void { if (!this.disposed) this.deps.onChanged(); }
  private current(generation: number): boolean { return !this.disposed && generation === this.generation; }

  private async resolve(pin: string, generation: number): Promise<void> {
    let found: ResolvedPin | null;
    try { found = await this.deps.ipRelayClient.resolve(pin); }
    catch { found = null; }
    if (!this.current(generation)) return;
    this.resolving = false;
    if (!found) {
      this.connecting = false; this.error = "PIN did not resolve"; this.changed();
      this.schedule(() => this.start("pin", pin)); return;
    }
    this.connect(found.ip, found.port, generation, () => this.start("pin", pin));
  }

  private connect(host: string, port: number, generation: number, retry: () => void): void {
    if (!this.current(generation)) return;
    try {
      const url = buildModuleWebSocketUrl(host, port);
      if (this.started) this.deps.session.stop();
      this.deps.transport.setUrl(url);
      saveModuleHost(this.deps.hostStore, host);
      this.deps.session.start(); this.started = true;
    } catch (error) {
      if (!this.current(generation)) return;
      this.connecting = false; this.error = `Connection failed: ${String(error)}`;
      this.changed(); this.schedule(retry); return;
    }
    if (!this.current(generation)) return;
    this.polling = true; this.pollEvent.reset(0.1);
  }

  private schedule(retry: () => void): void {
    if (this.disposed) return;
    this.retry = retry; this.retryEvent.reset(2);
  }

  private poll(): void {
    if (this.disposed || !this.polling) return;
    if (this.deps.session.view().connection === "ready") {
      this.cancel(); this.changed(); return;
    }
    this.changed();
    if (this.polling) this.pollEvent.reset(0.1);
  }
}
