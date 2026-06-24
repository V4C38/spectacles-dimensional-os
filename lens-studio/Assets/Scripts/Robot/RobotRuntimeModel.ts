// ================================================================
/**
 * Pure functions for RobotRuntimeState: bridge hello projection, capability
 * queries, and geometry derived from negotiated robot metadata.
 * State shape + defaults live in Core/AppState.ts.
 */
// ================================================================

import { RobotRuntimeState, createDefaultRobotRuntimeState } from "../Core/AppState";
import { HelloMessage, protocolMetersToLensCentimeters } from "../Bridge/BridgeDomain";

const DEFAULT_ROBOT_BODY_HEIGHT_M = 0.55;
const LIDAR_FLOOR_CLEARANCE_CM = 0.5;
const LIDAR_MAX_HEIGHT_ABOVE_BODY_M = 1.0;

export interface LidarVerticalBandCm {
  minAboveFloorCm: number;
  maxAboveFloorCm: number;
}

/** Build a full RobotRuntimeState from a hello handshake message. */
export function projectRuntimeStateFromHello(msg: HelloMessage): RobotRuntimeState {
  const capabilities = createDefaultRobotRuntimeState().capabilities;
  // v4: capabilities is the unified map (no separate capability_states)
  Object.keys(msg.capabilities).forEach((capability) => {
    const state = msg.capabilities[capability];
    capabilities[capability] = {
      available: state.available,
      reason: state.reason ?? null,
    };
  });
  return {
    negotiated: true,
    robotId: msg.robot.robot_id,
    displayName: msg.robot.display_name,
    visualOriginFrame: msg.robot.visual_origin_frame,
    bodyBoundsM: msg.robot.body_bounds_m ?? null,
    footprintM: msg.robot.footprint_m ?? null,
    baseHeightM: msg.robot.base_height_m ?? null,
    defaultRenderOffsetM: msg.robot.default_render_offset_m ?? null,
    tagTrackingProfile: msg.robot.tag_tracking_profile ?? null,
    capabilities,
  };
}

/**
 * Compute the navigation placement deadzone radius (cm) from the negotiated
 * robot footprint, falling back to `fallbackCm` when not yet negotiated.
 */
export function runtimeDeadzoneRadiusCm(
  state: RobotRuntimeState,
  fallbackCm: number,
): number {
  const footprint = state.footprintM;
  if (!state.negotiated || !footprint) {
    return fallbackCm;
  }
  const maxDimensionCm = Math.max(footprint[0], footprint[1]) * 100.0;
  return Math.max(20.0, maxDimensionCm * 0.5 + 20.0);
}

/** Compute the robot marker render offset (cm) from the negotiated default offset. */
export function runtimeRenderOffsetCm(state: RobotRuntimeState): vec3 {
  const offset = state.defaultRenderOffsetM;
  if (!offset) {
    return new vec3(0, 0, 0);
  }
  return protocolMetersToLensCentimeters(offset);
}

/** Return true when the named capability is available (defaults to true when not negotiated). */
export function isCapabilityAvailable(state: RobotRuntimeState, capability: string): boolean {
  const cap = state.capabilities[capability];
  return cap ? cap.available : true;
}

/** Return the unavailability reason for the named capability, or null when available/unknown. */
export function capabilityUnavailableReason(state: RobotRuntimeState, capability: string): string | null {
  const cap = state.capabilities[capability];
  return cap ? cap.reason : null;
}

/** Robot body height (m) from negotiated runtime metadata. */
export function robotBodyHeightM(runtime: RobotRuntimeState): number {
  if (runtime.bodyBoundsM) {
    return runtime.bodyBoundsM[2];
  }
  if (runtime.baseHeightM !== null) {
    return runtime.baseHeightM;
  }
  return DEFAULT_ROBOT_BODY_HEIGHT_M;
}

/** LiDAR vertical band above the robot floor plane (world cm). */
export function lidarVerticalBandCm(runtime: RobotRuntimeState): LidarVerticalBandCm {
  const bodyHeightCm = robotBodyHeightM(runtime) * 100.0;
  return {
    minAboveFloorCm: LIDAR_FLOOR_CLEARANCE_CM,
    maxAboveFloorCm: bodyHeightCm + LIDAR_MAX_HEIGHT_ABOVE_BODY_M * 100.0,
  };
}

/** World-space floor Y (cm) from marker origin Y and negotiated robot base height. */
export function robotFloorWorldYCm(
  markerWorldYCm: number,
  runtime: RobotRuntimeState,
): number {
  if (!runtime.negotiated) {
    // AprilTag / offline marker origin is elevated on the robot body; subtract
    // the default body height so the floor lands at ground contact.
    return markerWorldYCm - robotBodyHeightM(runtime) * 100.0;
  }
  const baseHeightM =
    runtime.baseHeightM ??
    (runtime.bodyBoundsM ? runtime.bodyBoundsM[2] : null);
  if (baseHeightM === null) {
    return markerWorldYCm - robotBodyHeightM(runtime) * 100.0;
  }
  return markerWorldYCm - baseHeightM * 100.0;
}
