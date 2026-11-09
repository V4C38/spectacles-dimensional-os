import { EnvironmentDepthRenderer } from "./presentation/EnvironmentDepthRenderer";
import * as THREE from "three";
import * as xb from "xrblocks";
import { DimOSWebXRClient } from "./DimOSWebXRClient";
import { reportDiagnostic } from "./diagnostics/BrowserDiagnostics";
import { WebXRInputController } from "./input/WebXRInputController";
import { WebXRSessionController } from "./WebXRSessionController";

/** SDK composition only; tracking and input each have one lifecycle owner. */
export class WebXRApp extends xb.Script {
  static dependencies = { input: xb.Input };
  isReady = false;
  private disposed = false;
  readonly inputController: WebXRInputController;
  readonly sessions: WebXRSessionController;
  private environmentDepth: EnvironmentDepthRenderer | null = null;

  constructor(private readonly client: DimOSWebXRClient) {
    super();
    this.inputController = new WebXRInputController(client, this, {
      session: () => this.sessions.session, tracking: () => this.sessions.tracking,
    });
    this.sessions = new WebXRSessionController({
      renderer: () => xb.core.renderer.xr,
      localized: () => client.ui.setupCompleted && client.originStore.hasTrackingOrigin,
      setupCompleted: () => client.ui.setupCompleted,
      suspend: () => {
        this.inputController.suspend();
        client.ui.trackingStatus = "Tracking paused";
        client.suspend();
      },
      reset: () => { this.inputController.reset(); client.invalidateTracking(); },
      resume: () => {
        this.inputController.setEnabled(true);
        client.resumeTracking();
        if (client.ui.wizardStep === "localization" && !client.originStore.hasTrackingOrigin &&
            client.episode.view().phase === "idle") client.ui.restartLocalization();
      },
      recoverUnknownReset: () => client.recoverUnknownTrackingReset(),
      reviewAlignment: reason => client.ui.requestAlignmentReview(reason),
      inputSourcesChanged: () => this.inputController.inputSourcesChanged(),
      detach: () => this.inputController.setEnabled(false),
      end: () => { client.session.stop(); client.restartSetup(); },
    });
  }

  get sound() { return this.inputController.sound; }
  get mainMenu() { return this.inputController.menu; }
  get interaction() { return this.inputController.rays; }
  get navigationFloor() { return this.inputController.floor; }
  get tracking() { return this.sessions.tracking; }
  get session() { return this.sessions.session; }
  get reference() { return this.sessions.referenceSpace; }
  get worldHold() { return this.inputController.holdingWorld; }
  get panelHold() { return this.inputController.holdingPanel; }
  get scrollHold() { return this.inputController.scrolling; }
  get menuAnchor() { return this.inputController.anchor; }
  get setupPlacement() { return this.inputController.setupPosition; }
  get panelGrip() { return this.inputController.grippingPanel; }

  override init({ input }: { input: xb.Input }): void {
    const client = this.client;
    this.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    this.add(client.manipulation.object, client.robot.object, client.lidar.object, client.route.object,
      client.markers.object, client.navigation.marker.object, client.navigation.probeRoot,
      client.navigation.draftMarker.object, client.previewRoute.object, client.notifications.object);
    this.environmentDepth = new EnvironmentDepthRenderer(xb.core.renderer);
    this.inputController.init({ input });
    client.start();
    this.isReady = true;
    reportDiagnostic("app-initialized");
  }

  override onXRSessionStarted(session?: XRSession): void { this.sessions.start(session); }
  override onXRSessionEnded(): void { this.environmentDepth?.reset(); this.sessions.end(); }
  override update(time = performance.now(), frame?: XRFrame): void {
    const current = this.sessions.sample(time, frame);
    if (!current || !frame) return;
    const { viewer, reference, deltaS } = current;
    this.environmentDepth?.update(frame, viewer, [this.client.robot.object, this.client.route.object, this.client.previewRoute.object, this.client.manipulation.object]);
    const { position: p, orientation: q } = viewer.transform;
    this.client.tick({ position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] }, this.inputController.readJoystick());
    this.client.robot.orientFeedback(new THREE.Vector3(p.x, p.y, p.z));
    this.client.manipulation.renderer.faceViewer(new THREE.Vector3(p.x, p.y, p.z));
    this.client.notifications.tick([p.x, p.y, p.z], [q.x, q.y, q.z, q.w], viewer.views?.[0]?.projectionMatrix[5] ?? 1, deltaS);
    this.client.ui.trackingStatus = "Tracking";
    this.inputController.update(time, frame, viewer, reference, deltaS);
  }
  override onSelectStart(event: xb.SelectEvent): void { this.inputController.onSelectStart(event); }
  override onSelectEnd(event: xb.SelectEvent): void { this.inputController.onSelectEnd(event); }
  override onSqueezeStart(event: xb.SelectEvent): void { this.inputController.onSqueezeStart(event); }
  override onSqueezeEnd(event: xb.SelectEvent): void { this.inputController.onSqueezeEnd(event); }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.environmentDepth?.dispose();
    this.sessions.detach();
    this.inputController.dispose();
    this.client.dispose();
    super.dispose();
  }
}
