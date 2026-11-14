import { isManualControlEnabled } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";
import { alignmentDistance, type AlignmentWarning } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/NotificationCenter";
import type { ReadonlyFacts } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import type { ClientTrackingOrigin as MutableClientTrackingOrigin, ClientTrackingOriginStore } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import type { ARModuleSession } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ARModuleSession";
import type { LocalizationCaptureEpisode } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/LocalizationCaptureEpisode";
import type { RobotSelection } from "DimOSARClient.lspkg/Scripts/DimOSARClient/robot/RobotPresentation";
import type { SpecsCameraSource } from "./localization/SpecsCameraSource";
import type { NavigationRouteRenderer } from "./navigation/SpecsNavigationRenderer";
import type { SpecsNavigationController, SpecsNavigationInput } from "./navigation/SpecsNavigationController";
import type { SpecsManipulationController } from "./manipulation/SpecsManipulationController";
import type { RobotPresenter } from "./presentation/RobotPresenter";
import type { UIPresenter } from "./presentation/UIPresenter";
import type { PointCloudRenderer } from "./sensors/PointCloudRenderer";
import type { ARMarkerPresenter } from "./presentation/ARMarkerPresenter";
import type { ViewerNotificationPresenter } from "./presentation/ViewerNotificationPresenter";
type ClientTrackingOrigin = ReadonlyFacts<MutableClientTrackingOrigin>;

/** Per-frame bookkeeping belongs here; Lens construction and event binding stay in the component. */
export class SpecsRuntimeCoordinator {
  private roomPresentationDirty = true;
  private lastOrigin: ClientTrackingOrigin | null = null;
  private previousSetup = false;
  private nextCaptureDiagnosticsAt = 0;
  private diagnosticFrames = 0;
  private diagnosticFrameS = 0;
  private diagnosticWorstS = 0;

  constructor(private readonly deps: {
    suspended(): boolean;
    syncSelectionEligibility(): void;
    publishPose(): void;
    streamDiagnostics(): unknown;
    cameraSource: SpecsCameraSource;
    session: ARModuleSession;
    episode: LocalizationCaptureEpisode;
    clientTrackingOriginStore: ClientTrackingOriginStore;
    activeRouteRenderer: NavigationRouteRenderer;
    navigationController: SpecsNavigationController;
    robotPresenter: RobotPresenter;
    uiPresenter: UIPresenter;
    cameraObject: SceneObject;
    selection: RobotSelection;
    lidarPresenter: PointCloudRenderer;
    manipulation: SpecsManipulationController;
    navigationInput: SpecsNavigationInput;
    previewRoute: NavigationRouteRenderer;
    annotations: ARMarkerPresenter;
    notifications: ViewerNotificationPresenter;
    alignmentWarning: AlignmentWarning;
  }) {}

  invalidateRoom(): void { this.roomPresentationDirty = true; }

  tick(): void {
    if (this.deps.suspended()) return;
    const rawDt = Math.max(0, getDeltaTime());
    const dt = Math.min(0.1, rawDt);
    this.sampleAndPump(rawDt);
    this.reportDiagnostics();
    this.deps.syncSelectionEligibility();
    this.deps.uiPresenter.tick(dt);
    const view = this.deps.session.view();
    const origin = this.deps.clientTrackingOriginStore.T_odom_client;
    const setup = this.deps.uiPresenter.isSetupCompleted();
    this.deps.syncSelectionEligibility();
    const viewportHeight = (this.deps.cameraObject.getComponent("Component.Camera") as Camera)?.renderTarget?.getHeight() ?? 1024;
    this.deps.robotPresenter.setViewportHeight(viewportHeight);
    this.deps.navigationController.setViewportHeight(viewportHeight);
    this.presentRoom(view, origin, setup);
    this.updateControls(view, origin, setup, dt);
    this.presentWorld(view, origin, setup, viewportHeight, dt);
    this.presentNotifications(view, origin, dt);
  }

  private updateControls(view: ReturnType<ARModuleSession["view"]>, origin: ClientTrackingOrigin | null, setup: boolean, dt: number): void {
    this.deps.robotPresenter.setSelected(this.deps.selection.isSelected());
    const controls = isManualControlEnabled(view, setup,
      this.deps.uiPresenter.isAlignmentReviewPending(), false, this.deps.uiPresenter.getOperatingMode());
    const navigationAvailable = view.capabilities?.navigation.available === true;
    const markerControls = isManualControlEnabled(view, setup,
      this.deps.uiPresenter.isAlignmentReviewPending(), false, "manual") &&
      view.state?.safety?.stopped !== true;
    const navigationEnabled = markerControls && navigationAvailable;
    this.deps.manipulation.renderer.debugEnabled = this.deps.uiPresenter.getDebugMode();
    this.deps.manipulation.tick(controls && !!origin);
    if (!navigationAvailable) this.deps.robotPresenter.reset();
    this.deps.navigationController.setInputEnabled(navigationEnabled);
    if (!setup || !navigationAvailable) this.deps.navigationController.hide();
    else this.deps.navigationController.applyView(view, origin);
    this.deps.navigationController.setSelected(this.deps.selection.isSelected());
    this.deps.navigationInput.tick(navigationEnabled, navigationAvailable && setup && !this.deps.uiPresenter.isAlignmentReviewPending() && view.connection === "ready");
    this.deps.navigationController.surveyFloor();
    this.deps.navigationController.tick(dt);
    const nav = this.deps.navigationController.interaction.snapshot();
    this.deps.robotPresenter.setNavigationFloor(!nav.attachedToRobot, this.deps.navigationController.circleOpacity());
  }

  private presentWorld(view: ReturnType<ARModuleSession["view"]>, origin: ClientTrackingOrigin | null, setup: boolean, viewportHeight: number, dt: number): void {
    const nav = this.deps.navigationController.interaction.snapshot();
    if (setup && origin && view.hasTrackingOrigin) {
      const prefs = this.deps.uiPresenter.getLidarPreferences();
      this.deps.lidarPresenter.apply({ points: view.lidar?.points ?? null, origin, mode: this.deps.uiPresenter.getLidarMode(),
        robot: view.pose?.position, orientation: view.pose?.orientation,
        baseHeightM: view.hello?.robot.base_height_m, bounds: view.hello?.robot.body_bounds_m,
        pointLimit: prefs.pointLimit, obstacleRangeM: prefs.obstacleRangeM,
        odomScaleCorrectionFactor: view.hello?.robot.odom_scale_correction_factor ?? 1, viewportHeight });
      const circles = { startCircle: this.deps.robotPresenter.floorCircleBounds(), viewportHeight };
      this.deps.activeRouteRenderer.apply({ path: this.deps.navigationController.activePath(), origin,
        pathVisible: this.deps.navigationController.isArmed() && !nav.flash,
        floorY: this.deps.robotPresenter.floorWorldY(), goalY: this.deps.navigationController.currentPose()?.position.y,
        executing: nav.followingPath, endCircle: this.deps.navigationController.circleBounds(), ...circles });
      this.deps.previewRoute.apply({ path: this.deps.navigationController.previewPath(), origin,
        pathVisible: this.deps.navigationController.isAiming(), preview: true,
        floorY: this.deps.robotPresenter.floorWorldY(), goalY: this.deps.navigationController.currentPose()?.position.y,
        endCircle: this.deps.navigationController.draftCircleBounds(), ...circles });
    } else {
      this.deps.lidarPresenter.hide();
      this.deps.activeRouteRenderer.hide();
      this.deps.previewRoute.hide();
    }
    this.deps.annotations.update(this.deps.cameraObject.getTransform().getWorldPosition(), dt);
  }

  private sampleAndPump(rawDt: number): void {
    this.diagnosticFrames++;
    this.diagnosticFrameS += rawDt;
    this.diagnosticWorstS = Math.max(this.diagnosticWorstS, rawDt);
    this.deps.cameraSource.samplePose();
    this.deps.session.tick();
    this.deps.episode.tick();
    this.deps.publishPose();
  }

  private reportDiagnostics(): void {
    if (getTime() >= this.nextCaptureDiagnosticsAt) {
      this.nextCaptureDiagnosticsAt = getTime() + 30;
      print(`Capture diagnostics: ${JSON.stringify({ phase: this.deps.episode.view().phase, budget: this.deps.episode.captureBudget(), fps: this.diagnosticFrames / Math.max(0.001, this.diagnosticFrameS), worstFrameMs: this.diagnosticWorstS * 1000, camera: this.deps.cameraSource.diagnostics(), stream: this.deps.streamDiagnostics() })}`);
      if (this.deps.uiPresenter.getDebugMode()) print(`LiDAR alignment: ${JSON.stringify(this.deps.lidarPresenter.spatialDiagnostics(this.deps.cameraObject.getComponent("Component.Camera") as Camera))}`);
      this.diagnosticFrames = 0;
      this.diagnosticFrameS = 0;
      this.diagnosticWorstS = 0;
    }
  }

  private presentRoom(view: ReturnType<ARModuleSession["view"]>, origin: ClientTrackingOrigin | null, setup: boolean): void {
    if (this.roomPresentationDirty || this.previousSetup !== setup || this.lastOrigin !== origin) {
      this.roomPresentationDirty = false;
      this.previousSetup = setup;
      this.deps.uiPresenter.applyRoomPresentation(view);
      if (view.connection !== "ready") this.deps.annotations.clearAll();
      if (origin && origin !== this.lastOrigin) this.deps.annotations.recompose(origin);
      this.lastOrigin = origin;
    }
  }

  private presentNotifications(view: ReturnType<ARModuleSession["view"]>, origin: ClientTrackingOrigin | null, dt: number): void {
    let viewer: import("DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts").Vec3 | null = null;
    try { viewer = this.deps.cameraSource.trackingPosition(); }
    catch { /* Tracking sampling may be unavailable between visible frames. */ }
    this.deps.alignmentWarning.update(alignmentDistance(view, origin, viewer),
      view.hello?.localization?.providers.includes("vps") === true, this.deps.episode.view().phase, this.deps.notifications);
    this.deps.notifications.tick(dt);
  }
}
