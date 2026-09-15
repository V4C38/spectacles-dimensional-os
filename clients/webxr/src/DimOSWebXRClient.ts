import type { ClientClock } from "@dimos-ar-client/websocket/hostPorts";
import {
  ClientTrackingOriginStore,
  type ClientTrackingOrigin,
} from "@dimos-ar-client/localization/clientTrackingOrigin";
import { LocalizationCaptureEpisode } from "@dimos-ar-client/localization/localizationCaptureEpisode";
import {
  clientTrackingToOdomPose,
  rotateVecByQuat,
} from "@dimos-ar-client/localization/clientTrackingTransforms";
import { parsePlaceArMarkerArgs, parseRemoveArMarkerArgs } from "@dimos-ar-client/agent/agentSkills";
import { ARModuleSession } from "@dimos-ar-client/websocket/arModuleSession";
import { encodeClientPose } from "@dimos-ar-client/websocket/protocol";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { HmdCameraSource } from "./camera/HmdCameraSource";
import { WebXRJoystick, type JoystickAxes } from "./navigation/WebXRJoystick";
import {
  robotDeadzoneRadiusM,
  WebXRNavigationController,
} from "./navigation/WebXRNavigationController";
import {
  intersectRayPlanes,
  type FloorPlane,
  type RobotGroundDeadzone,
} from "./navigation/WebXRGroundPlacement";
import { WebXRARMarkerPresenter } from "./presentation/WebXRARMarkerPresenter";
import {
  WebXRLidarRenderer,
  WebXRRobotPresenter,
  WebXRRouteRenderer,
} from "./presentation/WebXRPresenters";
import { WebXRUIPresenter } from "./presentation/WebXRUIPresenter";
import { BrowserWebSocketTransport } from "./websocket/BrowserWebSocketTransport";

export interface DimOSWebXRClientDeps {
  transport: BrowserWebSocketTransport;
  clock: ClientClock;
  camera: HmdCameraSource;
}

export class DimOSWebXRClient {
  readonly session: ARModuleSession;
  readonly episode: LocalizationCaptureEpisode;
  readonly originStore: ClientTrackingOriginStore;
  readonly ui: WebXRUIPresenter;
  readonly robot: WebXRRobotPresenter;
  readonly lidar: WebXRLidarRenderer;
  readonly route: WebXRRouteRenderer;
  readonly markers: WebXRARMarkerPresenter;
  readonly navigation: WebXRNavigationController;
  readonly joystick: WebXRJoystick;

  private readonly transport: BrowserWebSocketTransport;
  private readonly clock: ClientClock;
  private readonly camera: HmdCameraSource;
  private unsubscribeView: (() => void) | null = null;
  private unsubscribeOutbound: (() => void) | null = null;
  private lastView: ReturnType<ARModuleSession["view"]> | null = null;
  private lastClientPoseSentAt = Number.NEGATIVE_INFINITY;
  private lastMarkerOrigin: ClientTrackingOrigin | null = null;
  private lastCamera: { position: Vec3; orientation: Quat } | null = null;
  private disposed = false;

  constructor(deps: DimOSWebXRClientDeps) {
    this.transport = deps.transport;
    this.clock = deps.clock;
    this.camera = deps.camera;
    this.originStore = new ClientTrackingOriginStore();
    this.session = new ARModuleSession({
      transport: deps.transport,
      clock: deps.clock,
      clientTrackingOriginStore: this.originStore,
    });
    this.transport.bind({
      onTransportOpen: () => this.session.onTransportOpen(),
      onTransportClose: () => this.session.onTransportClose(),
      onTransportText: (chunk) => this.session.onTransportText(chunk),
      onTransportBinary: (data) => this.session.onTransportBinary(data),
    });
    this.episode = new LocalizationCaptureEpisode({
      session: this.session,
      clientTrackingOriginStore: this.originStore,
      clock: deps.clock,
      tracking: deps.camera,
      capture: deps.camera,
    });
    this.ui = new WebXRUIPresenter(this.session, this.episode);
    this.robot = new WebXRRobotPresenter();
    this.lidar = new WebXRLidarRenderer();
    this.route = new WebXRRouteRenderer();
    this.markers = new WebXRARMarkerPresenter();
    this.navigation = new WebXRNavigationController(this.session);
    this.joystick = new WebXRJoystick(this.session);
  }

  start(): void {
    this.unsubscribeView = this.session.subscribeView((view) => {
      const prev = this.lastView;
      this.lastView = view;
      this.ui.onSessionView(view, prev, this.clock.now());
      if (view.connection === "disconnected") {
        this.markers.clearAll();
        this.lastMarkerOrigin = null;
      }
      this.applyView();
    });
    this.unsubscribeOutbound = this.session.subscribeOutbound((message) => {
      if (message.type !== "agent_skill") {
        return;
      }
      try {
        if (message.name === "ar_place_marker") {
          const origin = this.originStore.T_odom_client;
          if (!origin) {
            return;
          }
          this.markers.apply(parsePlaceArMarkerArgs(message.args), origin);
          return;
        }
        if (message.name === "ar_remove_marker") {
          this.markers.remove(parseRemoveArMarkerArgs(message.args).id);
        }
      } catch (error) {
        console.error(error);
      }
    });
    this.session.start();
  }

  tick(cameraPose: { position: Vec3; orientation: Quat }, joystick: JoystickAxes | null): void {
    if (this.disposed) {
      return;
    }
    this.lastCamera = cameraPose;
    this.camera.samplePose(cameraPose.position, cameraPose.orientation);
    this.session.tick();
    this.episode.tick();
    const now = this.clock.now();
    this.ui.tick(now);
    this.navigation.tick(now);
    this.joystick.tick(now, joystick);
    this.maybeSendClientPose();
  }

  holdNavigation(rayFrom: Vec3, rayDir: Vec3, planes: readonly FloorPlane[]): void {
    if (!this.ui.setupCompleted) {
      return;
    }
    const origin = this.originStore.T_odom_client;
    if (!origin) {
      return;
    }
    const hit = intersectRayPlanes(rayFrom, rayDir, planes);
    this.navigation.hold(
      this.clock.now(),
      rayFrom,
      rayDir,
      hit ? [hit] : [],
      this.deadzone(),
      this.placementFloorY(hit),
    );
  }

  releaseNavigation(rayFrom: Vec3, rayDir: Vec3, planes: readonly FloorPlane[]): void {
    if (!this.ui.setupCompleted) {
      return;
    }
    const hit = intersectRayPlanes(rayFrom, rayDir, planes);
    this.navigation.release(
      this.clock.now(),
      rayFrom,
      rayDir,
      hit ? [hit] : [],
      this.deadzone(),
      this.placementFloorY(hit),
    );
  }

  cancelNavigation(): void {
    this.navigation.cancel(this.clock.now());
  }

  restartSetup(): void {
    this.ui.restartSetup();
    this.originStore.clear();
    this.episode.reset();
    this.navigation.reset();
    this.markers.clearAll();
    this.lastMarkerOrigin = null;
    this.lidar.hide();
    this.route.hide();
    this.robot.reset();
  }

  deadzone(): RobotGroundDeadzone | null {
    const robot = this.session.view().hello?.robot;
    if (!robot) {
      return null;
    }
    return {
      radiusM: robotDeadzoneRadiusM(robot.footprint_m),
      getRobotWorldPosition: () => this.robot.worldPosition(),
      getRobotFloorWorldY: () => this.robot.floorWorldY(),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeView?.();
    this.unsubscribeView = null;
    this.unsubscribeOutbound?.();
    this.unsubscribeOutbound = null;
    this.joystick.loseInput();
    this.navigation.dispose();
    this.markers.dispose();
    this.route.dispose();
    this.lidar.dispose();
    this.robot.dispose();
    this.episode.dispose();
    this.session.stop();
    this.camera.dispose();
    this.transport.close();
  }

  private applyView(): void {
    const view = this.session.view();
    const origin = this.originStore.T_odom_client;
    const now = this.clock.now();
    this.robot.apply(view, origin, this.ui.setupCompleted, this.unlocalizedFallback());
    if (!this.ui.setupCompleted || !view.hasTrackingOrigin || !origin) {
      this.lidar.hide();
      this.route.hide();
      this.navigation.applyView(view, null, null, now);
      return;
    }
    this.lidar.apply(view.lidar?.points ?? null, origin);
    this.navigation.applyView(view, origin, this.robot.floorPose(), now);
    const goalY = this.navigation.marker.object.visible ? this.navigation.marker.pose().position[1] : null;
    this.route.apply(
      view.nav_goal?.path_poses ?? null,
      origin,
      this.navigation.isRouteVisible(),
      this.robot.floorWorldY(),
      goalY,
    );
    if (origin !== this.lastMarkerOrigin) {
      this.lastMarkerOrigin = origin;
      this.markers.recompose(origin);
    }
  }

  private unlocalizedFallback(): Vec3 | null {
    if (!this.lastCamera) {
      return null;
    }
    const forward = rotateVecByQuat(this.lastCamera.orientation, [0, 0, -1]);
    return [
      this.lastCamera.position[0] + forward[0] * 1.4,
      0,
      this.lastCamera.position[2] + forward[2] * 1.4,
    ];
  }

  private placementFloorY(hit: { position: Vec3 } | null): number {
    return this.robot.floorWorldY() ?? hit?.position[1] ?? 0;
  }

  private maybeSendClientPose(): void {
    const now = this.clock.now();
    if (now - this.lastClientPoseSentAt < 0.1) {
      return;
    }
    const view = this.session.view();
    if (view.connection !== "ready" || view.capabilities?.agent.available !== true) {
      return;
    }
    const origin = this.originStore.T_odom_client;
    if (!origin) {
      return;
    }
    let optical: ReturnType<HmdCameraSource["cameraOptical"]>;
    try {
      optical = this.camera.cameraOptical();
    } catch {
      return;
    }
    const odom = clientTrackingToOdomPose(optical, origin);
    this.session.sendText(
      encodeClientPose({
        position: odom.position,
        orientation: odom.orientation,
        ts: now,
      }),
    );
    this.lastClientPoseSentAt = now;
  }
}
