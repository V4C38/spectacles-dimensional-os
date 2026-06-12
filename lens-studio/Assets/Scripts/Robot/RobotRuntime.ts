// ================================================================
/**
 * Pure functions for projecting robot runtime state from protocol messages.
 * No `this` dependency — extracted from DimosManager for testability and clarity.
 */
// ================================================================

import { RobotRuntimeState, createDefaultRobotRuntimeState } from "../AppState";
import { HelloMessage } from "../Network/ProtocolTypes";
import { protocolMetersToLensCentimeters } from "../Network/Protocol";

/** Build a full RobotRuntimeState from a hello handshake message. */
export function projectRuntimeStateFromHello(msg: HelloMessage): RobotRuntimeState {
  const capabilities = createDefaultRobotRuntimeState().capabilities;
  Object.keys(msg.capability_states).forEach((capability) => {
    const state = msg.capability_states[capability];
    capabilities[capability] = {
      available: state.available,
      reason: state.reason ?? null,
    };
  });
  return {
    negotiated: true,
    robotId: msg.robot.robot_id,
    robotModel: msg.robot.robot_model,
    displayName: msg.robot.display_name,
    visualOriginFrame: msg.robot.visual_origin_frame,
    bodyBoundsM: msg.robot.body_bounds_m ?? null,
    footprintM: msg.robot.footprint_m ?? null,
    baseHeightM: msg.robot.base_height_m ?? null,
    defaultRenderOffsetM: msg.robot.default_render_offset_m ?? null,
    alignmentProfile: msg.robot.alignment_profile ?? null,
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
