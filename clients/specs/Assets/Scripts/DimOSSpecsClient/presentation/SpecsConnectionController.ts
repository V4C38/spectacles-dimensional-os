import type { ARModuleSession } from "../../DimOSARClient/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "../../DimOSARClient/websocket/hostPorts";
import { buildModuleWebSocketUrl, isValidHost, saveModuleHost, type ModuleHostStore } from "../../DimOSARClient/websocket/hostNormalization";
import { routeConnectionField, type ConnectionMethod, type ResolvedPin } from "../IpRelayClient";

const PIN_STORAGE_KEY = "dimos_ar_module_pin";

export interface SpecsConnectionDependencies {
  script: Pick<ScriptComponent, "createEvent" | "removeEvent">;
  session: Pick<ARModuleSession, "view" | "start" | "stop" | "subscribeView">;
  transport: { setUrl(url: string): void };
  hostStore: ModuleHostStore;
  ipRelayClient: { resolve(pin: string): Promise<ResolvedPin | null> };
  onChanged(): void;
  onPinConsumed?(): void;
  onConnectionTargetChanged?(): void;
}

/** Bounded setup attempts; established sessions retain their reconnect owner. */
export class SpecsConnectionController {
  private generation = 0;
  private disposed = false;
  private started = false;
  private connecting = false;
  private resolving = false;
  private error: string | null = null;
  private attempt: { method: ConnectionMethod; field: string; loadedPin: boolean; retries: number } | null = null;
  private readonly retryEvent: DelayedCallbackEvent;
  private readonly unsubscribe: () => void;
  private readonly resolutionTimeoutEvent: DelayedCallbackEvent;

  constructor(private readonly deps: SpecsConnectionDependencies) {
    this.resolutionTimeoutEvent = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.retryEvent = deps.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    this.retryEvent.bind(() => { if (!this.disposed && this.attempt) this.beginAttempt(); });
    this.unsubscribe = deps.session.subscribeView(() => this.observeSession());
  }

  snapshot(): Readonly<{ connecting: boolean; resolvingPin: boolean; error: string | null }> {
    return { connecting: this.connecting, resolvingPin: this.resolving, error: this.error };
  }

  storedPin(): string {
    const store = this.deps.hostStore;
    const routed = store.has(PIN_STORAGE_KEY) ? routeConnectionField("pin", store.getString(PIN_STORAGE_KEY)) : null;
    return routed?.kind === "pin" ? routed.pin : "";
  }

  start(method: ConnectionMethod, field: string, loadedPin = false): void {
    if (this.disposed) return;
    this.cancel(true);
    const routed = routeConnectionField(method, field);
    if (!routed || routed.kind === "ip" && !isValidHost(routed.host)) {
      this.error = method === "pin" ? "Enter a 6-digit PIN" : "Enter a valid IP address";
      this.changed(); return;
    }
    if (routed.kind === "pin" && !loadedPin) this.deps.hostStore.putString(PIN_STORAGE_KEY, routed.pin);
    this.attempt = { method, field: field.trim(), loadedPin, retries: 3 };
    this.beginAttempt();
  }

  private beginAttempt(): void {
    const attempt = this.attempt;
    if (!attempt || this.disposed) return;
    const generation = ++this.generation;
    this.error = null; this.connecting = true;
    if (attempt.method === "pin") {
      this.resolving = true; this.changed();
      void this.resolve(attempt.field, generation);
    } else {
      this.changed();
      this.connect(attempt.field, AR_MODULE_CLIENT_CONFIG.port, generation);
    }
  }

  private failAttempt(message: string): void {
    const attempt = this.attempt;
    if (!attempt || this.disposed) return;
    this.generation++;
    this.resolving = false;
    this.resolutionTimeoutEvent.cancel();
    if (this.started) { this.started = false; this.deps.session.stop(); }
    this.error = message;
    if (attempt.retries > 0) {
      attempt.retries--; this.retryEvent.reset(1);
    } else {
      this.connecting = false; this.attempt = null;
      if (attempt.loadedPin && attempt.method === "pin") {
        if (this.storedPin() === attempt.field) this.deps.hostStore.remove(PIN_STORAGE_KEY);
        this.deps.onPinConsumed?.();
      }
    }
    this.changed();
  }

  cancel(disconnect = false): void {
    this.generation++;
    this.attempt = null; this.retryEvent.cancel();
    this.resolutionTimeoutEvent.cancel();
    this.connecting = false; this.resolving = false; this.error = null;
    if (disconnect || this.started && this.deps.session.view().connection !== "ready") {
      this.deps.session.stop(); this.started = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.cancel();
    this.deps.script.removeEvent(this.retryEvent);
    this.deps.script.removeEvent(this.resolutionTimeoutEvent);
  }

  private changed(): void { if (!this.disposed) this.deps.onChanged(); }
  private current(generation: number): boolean { return !this.disposed && generation === this.generation; }

  private async resolve(pin: string, generation: number): Promise<void> {
    this.resolutionTimeoutEvent.bind(() => {
      if (!this.current(generation)) return;
      this.failAttempt("PIN lookup timed out");
    });
    this.resolutionTimeoutEvent.reset(15);
    let found: ResolvedPin | null;
    try { found = await this.deps.ipRelayClient.resolve(pin); }
    catch { found = null; }
    if (!this.current(generation)) return;
    this.resolutionTimeoutEvent.cancel();
    this.resolving = false;
    if (!found) {
      this.failAttempt("PIN did not resolve"); return;
    }
    this.connect(found.ip, found.port, generation);
  }

  private connect(host: string, port: number, generation: number): void {
    if (!this.current(generation)) return;
    try {
      const url = buildModuleWebSocketUrl(host, port);
      if (this.started) this.deps.session.stop();
      this.deps.onConnectionTargetChanged?.();
      this.deps.transport.setUrl(url);
      saveModuleHost(this.deps.hostStore, host);
      this.started = true;
      this.deps.session.start();
    } catch (error) {
      if (!this.current(generation)) return;
      this.failAttempt(`Connection failed: ${String(error)}`); return;
    }
  }

  private observeSession(): void {
    if (this.disposed || !this.attempt || !this.started) return;
    if (this.deps.session.view().connection === "ready") {
      this.cancel(); this.changed(); return;
    }
    const view = this.deps.session.view();
    if (view.connection === "failed" || view.connection === "disconnected") {
      this.failAttempt("Connection failed. Check the launcher and submit again."); return;
    }
    this.changed();
  }
}
