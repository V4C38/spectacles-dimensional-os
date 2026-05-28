import { BridgeClient } from "./Network/BridgeClient";
import { AlignmentController } from "./Alignment/AlignmentController";
import { LidarPointCloud } from "./Rendering/LidarPointCloud";
import { RobotMarker } from "./Rendering/RobotMarker";

/**
 * Top-level orchestrator. SetupWizard completes first, then hands control here.
 */
@component
export class DimosManager extends BaseScriptComponent {
  private static readonly MANUAL_MARKER_FORWARD_CM = 35.0;
  private static readonly MANUAL_MARKER_DOWN_CM = 18.0;

  @input
  bridgeClient: BridgeClient;

  @input
  alignmentController: AlignmentController;

  @input
  lidarPointCloud: LidarPointCloud;

  @input
  robotMarker: RobotMarker;

  private _isActive = false;
  private _debugMode = false;
  private _showLidar = true;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.setIsActive(false);
      if (!this.bridgeClient) {
        return;
      }
      this.bridgeClient.ensureEventHandlers();
      this.bridgeClient.onLidar.push((msg) => {
        if (this._isActive && this._showLidar && this.lidarPointCloud) {
          this.lidarPointCloud.queueLidar(msg);
        }
      });
      this.bridgeClient.onPose.push((msg) => {
        if (this._isActive && this.robotMarker) {
          this.robotMarker.applyPose(msg);
        }
      });
    });
  }

  public setIsActive(active: boolean): void {
    this._isActive = active;
    if (!active && this.lidarPointCloud) {
      this.lidarPointCloud.clear();
    }
    if (this.robotMarker) {
      this.robotMarker.setVisible(active);
    }
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public setBaseUrl(url: string): void {
    if (this.bridgeClient) {
      this.bridgeClient.baseUrl = url;
    }
  }

  public getBaseUrl(): string {
    return this.bridgeClient ? this.bridgeClient.baseUrl : "";
  }

  public saveIp(ip: string): void {
    if (this.bridgeClient) {
      this.bridgeClient.saveIp(ip);
    }
  }

  public loadIp(): string | null {
    return this.bridgeClient ? this.bridgeClient.loadIp() : null;
  }

  public async checkConnection(): Promise<boolean> {
    if (!this.bridgeClient) {
      return false;
    }
    try {
      await this.bridgeClient.connect();
      const ready = await this.bridgeClient.waitForHello(3.0);
      if (ready) {
        this.bridgeClient.requestStatus();
      }
      return ready;
    } catch (error) {
      print(`DimosManager: checkConnection failed: ${error}`);
      return false;
    }
  }

  public disconnect(): void {
    if (this.bridgeClient) {
      this.bridgeClient.disconnect();
    }
  }

  public placeRobotMarkerInFrontOf(reference: SceneObject): void {
    if (!this.robotMarker || !reference) {
      return;
    }
    const transform = reference.getTransform();
    const worldPosition = transform.getWorldPosition();
    const worldRotation = transform.getWorldRotation();
    const forwardOffset = worldRotation.multiplyVec3(
      new vec3(0, 0, -DimosManager.MANUAL_MARKER_FORWARD_CM),
    );
    const downOffset = worldRotation.multiplyVec3(
      new vec3(0, -DimosManager.MANUAL_MARKER_DOWN_CM, 0),
    );
    this.robotMarker.applyManualPose(
      new vec3(
        worldPosition.x + forwardOffset.x + downOffset.x,
        worldPosition.y + forwardOffset.y + downOffset.y,
        worldPosition.z + forwardOffset.z + downOffset.z,
      ),
      worldRotation,
    );
  }

  public hideRobotMarkerPreview(): void {
    if (!this._isActive && this.robotMarker) {
      this.robotMarker.setVisible(false);
    }
  }

  public setDebugMode(enabled: boolean): void {
    this._debugMode = enabled;
    if (this.alignmentController) {
      this.alignmentController.setDebugMode(enabled);
    }
  }

  public get debugMode(): boolean {
    return this._debugMode;
  }

  public setShowLidar(enabled: boolean): void {
    this._showLidar = enabled;
    if (!enabled && this.lidarPointCloud) {
      this.lidarPointCloud.clear();
    }
    print(`DimosManager: Show LiDAR ${enabled ? "on" : "off"}`);
  }

  public get showLidar(): boolean {
    return this._showLidar;
  }
}
