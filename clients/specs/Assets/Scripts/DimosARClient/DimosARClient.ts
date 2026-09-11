import { ClientTrackingOriginStore } from "./core/localization/clientTrackingOrigin";
import { LocalizationCaptureEpisode } from "./core/localization/localizationCaptureEpisode";
import { ARModuleSession } from "./core/websocket/arModuleSession";
import { AR_MODULE_CLIENT_CONFIG } from "./core/websocket/hostPorts";
import { SpecsCameraSource } from "./localization/SpecsCameraSource";
import { SpecsCameraStream } from "./localization/SpecsCameraStream";
import { SpecsWebSocketTransport } from "./websocket/SpecsWebSocketTransport";

@component
export class DimosARClient extends BaseScriptComponent {
  @input
  internetModule: InternetModule;

  @input
  arModuleHost: string;

  @input
  cameraObject: SceneObject;

  private session: ARModuleSession | null = null;
  private episode: LocalizationCaptureEpisode | null = null;
  private updateEvent: SceneEvent | null = null;

  onAwake(): void {
    if (!this.internetModule) {
      throw new Error("internetModule is required");
    }
    if (!this.cameraObject) {
      throw new Error("cameraObject is required");
    }

    const host = (this.arModuleHost ?? "").trim();
    const clock = { now: () => getTime() };
    const transport = new SpecsWebSocketTransport({
      internetModule: this.internetModule,
      script: this,
      url: `ws://${host}:${AR_MODULE_CLIENT_CONFIG.port}`,
    });
    const clientTrackingOriginStore = new ClientTrackingOriginStore();
    const session = new ARModuleSession({
      transport,
      clock,
      clientTrackingOriginStore,
    });
    this.session = session;

    transport.bind({
      onTransportOpen: () => session.onTransportOpen(),
      onTransportClose: () => session.onTransportClose(),
      onTransportText: (chunk) => session.onTransportText(chunk),
      onTransportBinary: (data) => session.onTransportBinary(data),
    });

    const cameraSource = new SpecsCameraSource({
      stream: SpecsCameraStream.getInstance(),
      cameraObject: this.cameraObject,
    });
    cameraSource.samplePose();
    const episode = new LocalizationCaptureEpisode({
      session,
      clientTrackingOriginStore,
      clock,
      tracking: cameraSource,
      capture: cameraSource,
    });
    this.episode = episode;

    const updateEvent = this.createEvent("UpdateEvent");
    updateEvent.bind(() => {
      cameraSource.samplePose();
      session.tick();
      episode.tick();
    });
    this.updateEvent = updateEvent;

    this.createEvent("OnDestroyEvent").bind(() => {
      this.episode!.dispose();
      this.updateEvent!.enabled = false;
      this.session!.stop();
    });

    if (host) {
      session.start();
    }
  }
}
