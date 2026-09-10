import { ClientTrackingOriginStore } from "./core/localization/clientTrackingOrigin";
import { ARModuleSession } from "./core/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "./core/websocket/hostPorts";
import { SpecsWebSocketTransport } from "./websocket/SpecsWebSocketTransport";

@component
export class DimosARClient extends BaseScriptComponent {
  @input
  internetModule: InternetModule;

  @input
  arModuleHost: string;

  private session: ARModuleSession | null = null;
  private updateEvent: SceneEvent | null = null;

  onAwake(): void {
    if (!this.internetModule) {
      throw new Error("internetModule is required");
    }

    const host = (this.arModuleHost ?? "").trim();
    const transport = new SpecsWebSocketTransport({
      internetModule: this.internetModule,
      script: this,
      url: `ws://${host}:${AR_MODULE_CLIENT_CONFIG.port}`,
    });
    const clientTrackingOriginStore = new ClientTrackingOriginStore();
    const session = new ARModuleSession({
      transport,
      clock: { now: () => getTime() },
      clientTrackingOriginStore,
    });
    this.session = session;

    transport.bind({
      onTransportOpen: () => session.onTransportOpen(),
      onTransportClose: () => session.onTransportClose(),
      onTransportText: (chunk) => session.onTransportText(chunk),
      onTransportBinary: (data) => session.onTransportBinary(data),
    });

    const updateEvent = this.createEvent("UpdateEvent");
    updateEvent.bind(() => session.tick());
    this.updateEvent = updateEvent;

    this.createEvent("OnDestroyEvent").bind(() => {
      this.updateEvent!.enabled = false;
      this.session!.stop();
    });

    if (host) {
      session.start();
    }
  }
}
