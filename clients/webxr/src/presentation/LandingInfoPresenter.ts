import { CAPABILITY_LABELS } from "@dimos-ar-client/presentation/CapabilityPresentation";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";

declare const __DIMOS_BUILD__: string;

/** Read-only DOM binding to the same session consumed by the immersive client. */
export class LandingInfoPresenter {
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly root: HTMLElement, server: string) {
    this.set("server", server);
    this.detail("build", typeof __DIMOS_BUILD__ === "undefined" ? undefined : __DIMOS_BUILD__);
    this.render(null);
  }
  bind(session: ARModuleSession): void {
    this.unsubscribe?.();
    this.unsubscribe = session.subscribeView(view => this.render(view));
    this.render(session.view());
  }
  private set(key: string, text: string): void { const node = this.root.querySelector(`[data-info="${key}"]`); if (node) node.textContent = text; }
  private detail(key: string, value: string | undefined): void {
    this.set(key, value ?? "Unavailable");
    const wrapper = this.root.querySelector<HTMLElement>(`[data-detail="${key}"]`);
    if (wrapper) wrapper.hidden = !value;
  }
  private render(view: ARModuleSessionState | null): void {
    const hello = view?.connection === "ready" ? view.hello : null;
    this.set("status", view?.connection === "ready" ? "Connected" : view?.connection === "connecting" || view?.connection === "awaiting_hello" ? "Connecting…" : view?.connection === "failed" ? "Reconnecting…" : "Disconnected");
    this.root.dataset.connection = view?.connection ?? "disconnected";
    this.set("robot", hello?.robot.display_name ?? "Robot");
    this.detail("robot-ip", hello?.server_info?.robot_ip);
    this.detail("dimos", hello?.server_info?.dimos_version);
    this.detail("armodule", hello?.server_info?.armodule_version);
    let count = 0;
    for (const key of Object.keys(CAPABILITY_LABELS) as (keyof typeof CAPABILITY_LABELS)[]) {
      const available = hello?.capabilities[key]?.available === true;
      const feature = this.root.querySelector<HTMLElement>(`[data-feature="${key}"]`);
      if (feature) {
        feature.hidden = !available;
        const label = feature.lastElementChild;
        if (label) label.textContent = CAPABILITY_LABELS[key];
      }
      if (available) count++;
    }
    this.set("features", !hello ? "Waiting for robot…" : count ? "" : "No features available");
  }
  dispose(): void { this.unsubscribe?.(); this.unsubscribe = null; }
}
