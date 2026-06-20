import { BridgeClient } from "../Bridge/BridgeClient";
import { FrameCaptureController } from "../Camera/FrameCaptureController";
import {
  AlignmentSession,
  AlignmentSessionDeps,
} from "../Alignment/AlignmentSession";
import { BridgeRuntime } from "../Bridge/BridgeRuntime";
import { DimosState } from "./DimosState";
import { NavigationController } from "../Navigation/NavigationController";
import { RobotRuntime, RobotRuntimeMenuCallbacks } from "../Robot/RobotRuntime";
import { SetupAlignmentPreview } from "../Setup/SetupAlignmentPreview";
import { PointCloudRenderer } from "../Lidar/PointCloudRenderer";
import { RobotMarker } from "../Robot/RobotMarker";

/** Scene wiring hub and Lens event host for DimOS runtime plain service classes. */
@component
export class DimosServices extends BaseScriptComponent {
  @input
  bridgeClient: BridgeClient;

  @input
  frameCaptureController: FrameCaptureController;

  @input
  robotMarker: RobotMarker;

  @input
  pointCloudRenderer: PointCloudRenderer;

  @input
  navigationMarkerPrefab: ObjectPrefab;

  @input
  groundDisc: SceneObject;

  @input
  robotGroundDeadzoneRadiusCm = 75;

  private _state: DimosState | null = null;
  private _robot: RobotRuntime | null = null;
  private _navigation: NavigationController | null = null;
  private _bridge: BridgeRuntime | null = null;
  private _alignment: AlignmentSession | null = null;
  private _setupPreview: SetupAlignmentPreview | null = null;
  private _bound = false;

  public get state(): DimosState {
    this._ensureInstances();
    return this._state!;
  }

  public get robot(): RobotRuntime {
    this._ensureInstances();
    return this._robot!;
  }

  public get navigation(): NavigationController {
    this._ensureInstances();
    return this._navigation!;
  }

  public get bridge(): BridgeRuntime {
    this._ensureInstances();
    return this._bridge!;
  }

  public get alignment(): AlignmentSession {
    this._ensureInstances();
    return this._alignment!;
  }

  public get setupPreview(): SetupAlignmentPreview {
    this._ensureInstances();
    return this._setupPreview!;
  }

  public bind(
    robotMenuCallbacks: RobotRuntimeMenuCallbacks,
    alignmentDeps: AlignmentSessionDeps,
  ): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._ensureInstances();

    this._robot!.bind(robotMenuCallbacks);
    this._navigation!.bindHost({
      dimosState: this._state!,
      robotRuntime: this._robot!,
    });
    this._alignment!.initialize(alignmentDeps);
    this._alignment!.bind();
    this._bridge!.bind();

    this.createEvent("UpdateEvent").bind(() => {
      this._bridge!.tick();
    });
  }

  private _ensureInstances(): void {
    if (this._state) {
      return;
    }
    this._state = new DimosState();
    this._robot = new RobotRuntime(
      this._state,
      this.robotMarker ?? null,
      this.pointCloudRenderer ?? null,
      this.bridgeClient ?? null,
    );
    this._alignment = new AlignmentSession(
      this.bridgeClient ?? null,
      this.frameCaptureController ?? null,
      this.robotMarker ?? null,
    );
    this._setupPreview = new SetupAlignmentPreview(
      this._state,
      this.groundDisc ?? null,
      this._robot,
      this._alignment,
    );
    this._navigation = NavigationController.create({
      eventHost: this,
      pathParentFallback: this.getSceneObject(),
      dimosState: this._state,
      bridgeClient: this.bridgeClient ?? null,
      robotRuntime: this._robot,
      robotMarker: this.robotMarker ?? null,
      navigationMarkerPrefab: this.navigationMarkerPrefab,
      robotGroundDeadzoneRadiusCm: this.robotGroundDeadzoneRadiusCm,
    });
    this._bridge = new BridgeRuntime(
      this.bridgeClient ?? null,
      this._state,
      this._robot,
      this._navigation,
      this.frameCaptureController ?? null,
    );
  }
}
