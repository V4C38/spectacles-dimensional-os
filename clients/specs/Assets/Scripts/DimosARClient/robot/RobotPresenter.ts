import type { ClientTrackingOrigin } from "../core/localization/clientTrackingOrigin";
import { odomToClientTrackingPose, rotateVecByQuat } from "../core/localization/clientTrackingTransforms";
import type { Pose, Quat, RobotDescription, Vec3 } from "../core/websocket/protocolTypes";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../SpecsCoordinates";

export function robotFloorOffsetCm(robot: RobotDescription): Vec3 {
  return clientTrackingToSpecsPoint([0, 0, -robot.base_height_m]);
}

export function robotDeadzoneRadiusCm(robot: RobotDescription): number {
  const maxDimensionCm = Math.max(...robot.footprint_m) * 100;
  return Math.max(20, maxDimensionCm * 0.5 + 20);
}

@component
export class RobotPresenter extends BaseScriptComponent {
  private robot: RobotDescription | null = null;
  private presented = false;

  onAwake(): void {
    this.hide();
  }

  apply(input: {
    robot: RobotDescription;
    pose: Pose | null;
    origin: ClientTrackingOrigin | null;
  }): void {
    if (!input.pose || !input.origin) {
      this.hide();
      return;
    }
    const specs = clientTrackingToSpecsPose(odomToClientTrackingPose(input.pose, input.origin));
    const root = this.getSceneObject();
    root.getTransform().setWorldPosition(toVec3(specs.position));
    root.getTransform().setWorldRotation(toQuat(specs.orientation));
    this.robot = input.robot;
    this.presented = true;
    root.enabled = true;
  }

  hide(): void {
    this.presented = false;
    this.robot = null;
    this.getSceneObject().enabled = false;
  }

  worldPosition(): vec3 | null {
    if (!this.presented) {
      return null;
    }
    return this.getSceneObject().getTransform().getWorldPosition();
  }

  worldRotation(): quat | null {
    if (!this.presented) {
      return null;
    }
    return this.getSceneObject().getTransform().getWorldRotation();
  }

  floorWorldY(): number | null {
    return this.floorPose()?.position.y ?? null;
  }

  floorPose(): { position: vec3; rotation: quat } | null {
    const position = this.worldPosition();
    const rotation = this.worldRotation();
    if (!position || !rotation || !this.robot) {
      return null;
    }
    const offset = rotateVecByQuat(fromQuat(rotation), robotFloorOffsetCm(this.robot));
    return {
      position: new vec3(position.x + offset[0], position.y + offset[1], position.z + offset[2]),
      rotation,
    };
  }

  deadzoneRadiusCm(): number | null {
    if (!this.presented || !this.robot) {
      return null;
    }
    return robotDeadzoneRadiusCm(this.robot);
  }
}

function toVec3(value: Vec3): vec3 {
  return new vec3(value[0], value[1], value[2]);
}

function toQuat(value: Quat): quat {
  return new quat(value[3], value[0], value[1], value[2]);
}
function fromQuat(value: quat): Quat {
  return [value.x, value.y, value.z, value.w];
}

