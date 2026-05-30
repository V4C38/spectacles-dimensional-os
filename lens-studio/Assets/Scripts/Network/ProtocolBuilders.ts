const LENS_CM_TO_PROTOCOL_M = 0.01;
const PROTOCOL_M_TO_LENS_CM = 100.0;

export function protocolMetersToLensCentimeters(
  position: [number, number, number],
): vec3 {
  return new vec3(
    position[0] * PROTOCOL_M_TO_LENS_CM,
    position[1] * PROTOCOL_M_TO_LENS_CM,
    position[2] * PROTOCOL_M_TO_LENS_CM,
  );
}

export function lensCentimetersToProtocolMeters(
  position: vec3,
): [number, number, number] {
  return [
    position.x * LENS_CM_TO_PROTOCOL_M,
    position.y * LENS_CM_TO_PROTOCOL_M,
    position.z * LENS_CM_TO_PROTOCOL_M,
  ];
}

export function buildGetStatus(robotId: string): string {
  return JSON.stringify({
    type: "get_status",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignStart(robotId: string): string {
  return JSON.stringify({
    type: "align_start",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignStop(robotId: string): string {
  return JSON.stringify({
    type: "align_stop",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignCommit(robotId: string): string {
  return JSON.stringify({
    type: "align_commit",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignManualPose(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  return JSON.stringify({
    type: "align_manual_pose",
    ts: getTime(),
    robot_id: robotId,
    position: lensCentimetersToProtocolMeters(position),
    orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildAlignMarker(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  return JSON.stringify({
    type: "align_marker",
    ts: getTime(),
    robot_id: robotId,
    marker_position: lensCentimetersToProtocolMeters(position),
    marker_orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildNavGoal(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  return JSON.stringify({
    type: "nav_goal",
    ts: getTime(),
    robot_id: robotId,
    frame: "world",
    position: lensCentimetersToProtocolMeters(position),
    orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildCancelGoal(robotId: string): string {
  return JSON.stringify({
    type: "cancel_goal",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildEmergencyStop(robotId: string): string {
  return JSON.stringify({
    type: "emergency_stop",
    ts: getTime(),
    robot_id: robotId,
  });
}
