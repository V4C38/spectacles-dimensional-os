import {
  AppStateData,
  bridgeNavigationReady,
} from "../AppState";
import {
  PathMessage,
  ProtocolParseError,
  protocolMetersToLensCentimeters,
} from "../../ARBridge/Network/Protocol";
import { NavigationClient } from "../../ARBridge/Navigation/NavigationClient";
import { type NavEngineState } from "../../ARBridge/Navigation/NavigationModel";
import { isCapabilityAvailable } from "../Robot/RobotRuntimeModel";

const PREVIEW_INTERVAL_S = 0.25;
const PREVIEW_STALE_TARGET_DISTANCE_CM = 12.0;

export type NavigationBridgeHandlerDeps = {
  navClient: NavigationClient | null;
  getAppState: () => AppStateData;
  getEngine: () => NavEngineState;
  isPlacementActive: () => boolean;
  onBridgePathApplied: () => void;
  presentation: {
    setPreviewPath: (waypoints: vec3[] | null) => void;
    setBridgePath: (waypoints: vec3[] | null) => void;
    sync: () => void;
    clearPreviewPath: () => void;
    clearPathDisplay: () => void;
  };
};

/** Inbound path/status wire handling, preview throttling, and protocol error counting. */
export class NavigationBridgeHandler {
  private _previewTarget: { position: vec3; rotation: quat } | null = null;
  private _lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  private _protocolParseFailureCount = 0;

  constructor(private readonly _deps: NavigationBridgeHandlerDeps) {}

  public get previewTarget(): { position: vec3; rotation: quat } | null {
    return this._previewTarget;
  }

  public setPreviewTarget(target: { position: vec3; rotation: quat } | null): void {
    this._previewTarget = target;
  }

  public resetPreviewState(): void {
    this._previewTarget = null;
    this._deps.presentation.clearPathDisplay();
    this._lastPreviewRequestTime = -PREVIEW_INTERVAL_S;
  }

  public clearProtocolErrorCount(): void {
    this._protocolParseFailureCount = 0;
  }

  public applyPath(msg: PathMessage): void {
    const waypoints =
      msg.waypoints.length >= 2
        ? msg.waypoints.map((point) => protocolMetersToLensCentimeters(point))
        : null;

    if (msg.kind === "preview") {
      if (!this._previewTarget) {
        return;
      }
      if (msg.target && !this._previewTargetMatches(msg.target)) {
        return;
      }
      this._deps.presentation.setPreviewPath(waypoints);
      this._deps.presentation.sync();
      return;
    }

    this._deps.presentation.setBridgePath(waypoints);
    if (this._deps.getEngine().goal !== null) {
      this._deps.onBridgePathApplied();
    }
    this._deps.presentation.sync();
  }

  public resyncPreviewGoal(): void {
    if (!this._previewTarget || this._deps.getEngine().goal !== null) {
      return;
    }
    this.maybeRequestPreview(true, this._deps.isPlacementActive());
  }

  public handleProtocolError(error: ProtocolParseError): void {
    this._protocolParseFailureCount += 1;
    if (this._protocolParseFailureCount < 3) {
      return;
    }
    if (this._deps.getAppState().navigationState !== "navigating") {
      return;
    }
    print(
      `NavigationBridgeHandler: protocol ${error.kind} failures while navigating; awaiting resync`,
    );
  }

  public maybeRequestPreview(force: boolean, placementActive: boolean): void {
    if (!this._previewTarget) {
      return;
    }
    const now = getTime();
    if (!force && now - this._lastPreviewRequestTime < PREVIEW_INTERVAL_S) {
      return;
    }
    this._lastPreviewRequestTime = now;
    if (this._canRequestPreviewPath(placementActive)) {
      const sent =
        this._deps.navClient?.sendPreviewGoal(
          this._previewTarget.position,
          this._previewTarget.rotation,
        ) ?? false;
      if (sent) {
        return;
      }
    }
    this._deps.presentation.clearPreviewPath();
  }

  private _canRequestPreviewPath(placementActive: boolean): boolean {
    const appState = this._deps.getAppState();
    return (
      (placementActive || !this._deps.getEngine().activeConfig?.allowDrag) &&
      bridgeNavigationReady(appState.bridgeSnapshot) &&
      isCapabilityAvailable(appState.robotRuntime, "nav") &&
      isCapabilityAvailable(appState.robotRuntime, "plan_preview")
    );
  }

  private _previewTargetMatches(targetMeters: [number, number, number]): boolean {
    if (!this._previewTarget) {
      return false;
    }
    return (
      this._previewTarget.position.distance(
        protocolMetersToLensCentimeters(targetMeters),
      ) <= PREVIEW_STALE_TARGET_DISTANCE_CM
    );
  }
}
