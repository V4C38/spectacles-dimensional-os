import {
  CAPABILITY_NAMES,
  type Capabilities,
  type Capability,
  type CapabilityName,
  type CapturePolicy,
  type DistortionModel,
  type Intrinsics,
  type Lidar,
  type LidarSettings,
  type LocalizationObservation,
  type LocalizationObservations,
  type LocalizationObservationsRequest,
  type LocalizationResult,
  type NavGoal,
  type NavState,
  type Outbound,
  type Pose,
  type Quat,
  type RobotDescription,
  type State,
  type TimeSync,
  type Vec3,
  type YawPose,
  type Hello,
} from "./types";

export const LOCALIZATION_OBSERVATIONS_FOURCC = 0x4c4f4341;
export const LIDAR_FOURCC = 0x4c444152;

const DISTORTION_MODELS: readonly DistortionModel[] = [
  "none",
  "plumb_bob",
  "equidistant",
];
const CAPTURE_POLICIES: readonly CapturePolicy[] = [
  "robot_los_required",
  "robot_los_preferred",
  "any_angle",
];

export function encodeText(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

export class TextFramer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  }
}

export function encodeHelloRequest(request: { ts_client: number }): string {
  return encodeText({
    type: "hello_request",
    ts_client: finiteNumber(request.ts_client, "ts_client"),
  });
}

export function encodeStateRequest(): string {
  return encodeText({ type: "state_request" });
}

export function encodeLocalizationStartRequest(): string {
  return encodeText({ type: "localization_start_request" });
}

export function encodeEstopRequest(): string {
  return encodeText({ type: "estop_request" });
}

export function encodeNavGoalRequest(request: {
  position: Vec3;
  orientation: Quat;
}): string {
  return encodeText({
    type: "nav_goal_request",
    position: requireVec3Value(request.position, "position"),
    orientation: requireQuatValue(request.orientation, "orientation"),
  });
}

export function encodeLidarSettingsRequest(request: LidarSettings): string {
  return encodeText({
    type: "lidar_settings_request",
    ...requireLidarSettings(request),
  });
}

export function encodeLocalizationObservations(
  observations: readonly LocalizationObservation[],
): Uint8Array {
  if (observations.length < 1) {
    throw new Error("localization_observations requires at least one observation");
  }
  if (observations.length > 0xffff) {
    throw new Error("observation_count exceeds uint16");
  }

  const records = observations.map(encodeObservationRecord);
  let total = 6;
  for (const record of records) {
    total += record.length;
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, LOCALIZATION_OBSERVATIONS_FOURCC, true);
  view.setUint16(4, observations.length, true);
  let offset = 6;
  for (const record of records) {
    out.set(record, offset);
    offset += record.length;
  }
  return out;
}

export function decodeOutbound(text: string): Exclude<Outbound, Lidar> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Frame must be a JSON object");
  }
  const data = asObject(parsed, "Frame");
  const msgType = requireString(data, "type");

  switch (msgType) {
    case "hello":
      return decodeHello(data);
    case "state":
      return decodeState(data);
    case "localization_observations_request":
      return decodeLocalizationObservationsRequest(data);
    case "localization_result":
      return decodeLocalizationResult(data);
    case "pose":
      return decodePose(data);
    case "nav_goal":
      return decodeNavGoal(data);
    default:
      throw new Error(`Unknown outbound frame type: '${msgType}'`);
  }
}

export function decodeLidar(data: Uint8Array): Lidar {
  if (data.byteLength < 16) {
    throw new Error("lidar frame too short");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = view.getUint32(0, true);
  if (fourcc !== LIDAR_FOURCC) {
    throw new Error(`bad lidar fourcc: 0x${fourcc.toString(16)}`);
  }
  const ts = view.getFloat64(4, true);
  if (!Number.isFinite(ts)) {
    throw new Error("Field 'ts' must be finite");
  }
  const pointCount = view.getUint32(12, true);
  const expected = 16 + pointCount * 12;
  if (data.byteLength !== expected) {
    throw new Error(
      `lidar payload length ${data.byteLength} != ${expected} for point_count ${pointCount}`,
    );
  }
  const points: Vec3[] = [];
  let offset = 16;
  for (let i = 0; i < pointCount; i++) {
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error("lidar point must be finite");
    }
    points.push([x, y, z]);
    offset += 12;
  }
  return { type: "lidar", ts, points };
}

export function decodeLocalizationObservations(data: Uint8Array): LocalizationObservations {
  if (data.byteLength < 6) {
    throw new Error("localization_observations frame too short");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = view.getUint32(0, true);
  if (fourcc !== LOCALIZATION_OBSERVATIONS_FOURCC) {
    throw new Error(`bad localization_observations fourcc: 0x${fourcc.toString(16)}`);
  }
  const observationCount = view.getUint16(4, true);
  if (observationCount < 1) {
    throw new Error("localization_observations requires at least one observation");
  }

  const observations: LocalizationObservation[] = [];
  let offset = 6;
  for (let i = 0; i < observationCount; i++) {
    const decoded = decodeObservationRecord(data, view, offset);
    observations.push(decoded.observation);
    offset = decoded.nextOffset;
  }
  if (offset !== data.byteLength) {
    throw new Error("localization_observations has unexplained trailing bytes");
  }
  return { type: "localization_observations", observations };
}

function encodeObservationRecord(observation: LocalizationObservation): Uint8Array {
  const tsCapture = finiteNumber(observation.ts_capture, "ts_capture");
  const position = requireVec3Value(observation.camera_position, "camera_position");
  const orientation = requireQuatValue(
    observation.camera_orientation,
    "camera_orientation",
  );
  const jpeg = observation.jpeg;
  const intrinsicsBytes = encodeIntrinsics(observation.intrinsics);
  const recordLen = 48 + jpeg.length + intrinsicsBytes.length;
  const out = new Uint8Array(4 + recordLen);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, recordLen, true);
  view.setFloat64(4, tsCapture, true);
  view.setUint32(12, jpeg.length, true);
  view.setUint32(16, intrinsicsBytes.length, true);
  view.setUint32(20, 0, true); // reserved; protocol.py reads camera at record_start+20
  writeFloat32Vec(view, 24, position);
  writeFloat32Vec(view, 36, orientation);
  out.set(jpeg, 52);
  out.set(intrinsicsBytes, 52 + jpeg.length);
  return out;
}

function encodeIntrinsics(intrinsics: Intrinsics): Uint8Array {
  return asciiBytes(JSON.stringify(requireIntrinsics(intrinsics)));
}

function decodeObservationRecord(
  data: Uint8Array,
  view: DataView,
  offset: number,
): { observation: LocalizationObservation; nextOffset: number } {
  if (data.byteLength - offset < 4) {
    throw new Error("truncated localization observation");
  }
  const recordLen = view.getUint32(offset, true);
  const recordStart = offset + 4;
  const recordEnd = recordStart + recordLen;
  if (recordEnd > data.byteLength) {
    throw new Error("localization observation record_len exceeds frame");
  }
  if (recordEnd < recordStart + 48) {
    throw new Error("localization observation header truncated");
  }

  const tsCapture = view.getFloat64(recordStart, true);
  if (!Number.isFinite(tsCapture)) {
    throw new Error("Field 'ts_capture' must be finite");
  }
  const jpegLen = view.getUint32(recordStart + 8, true);
  const intrinsicsLen = view.getUint32(recordStart + 12, true);
  if (view.getUint32(recordStart + 16, true) !== 0) {
    throw new Error("localization observation reserved word must be 0");
  }

  const camera_position: Vec3 = [
    view.getFloat32(recordStart + 20, true),
    view.getFloat32(recordStart + 24, true),
    view.getFloat32(recordStart + 28, true),
  ];
  const camera_orientation: Quat = [
    view.getFloat32(recordStart + 32, true),
    view.getFloat32(recordStart + 36, true),
    view.getFloat32(recordStart + 40, true),
    view.getFloat32(recordStart + 44, true),
  ];
  requireVec3Value(camera_position, "camera_position");
  requireQuatValue(camera_orientation, "camera_orientation");

  const payloadOffset = recordStart + 48;
  const jpegEnd = payloadOffset + jpegLen;
  const intrinsicsEnd = jpegEnd + intrinsicsLen;
  if (intrinsicsEnd > recordEnd) {
    throw new Error("localization observation payload exceeds record");
  }
  if (intrinsicsEnd !== recordEnd) {
    throw new Error("localization observation has unexplained record bytes");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(data.subarray(jpegEnd, intrinsicsEnd)));
  } catch {
    throw new Error("intrinsics must be a JSON object");
  }

  return {
    observation: {
      ts_capture: tsCapture,
      jpeg: data.slice(payloadOffset, jpegEnd),
      intrinsics: decodeIntrinsics(asObject(parsed, "intrinsics")),
      camera_position,
      camera_orientation,
    },
    nextOffset: recordEnd,
  };
}

function requireIntrinsics(intrinsics: Intrinsics): Intrinsics {
  if (!Number.isInteger(intrinsics.width) || !Number.isInteger(intrinsics.height)) {
    throw new Error("intrinsics.width and height must be integers");
  }
  if (!DISTORTION_MODELS.includes(intrinsics.distortion_model)) {
    throw new Error("intrinsics.distortion_model must be none, plumb_bob, or equidistant");
  }
  if (!Array.isArray(intrinsics.distortion)) {
    throw new Error("intrinsics.distortion must be a list");
  }
  if (intrinsics.distortion_model === "none" && intrinsics.distortion.length !== 0) {
    throw new Error("intrinsics.distortion must be empty when distortion_model is none");
  }
  return {
    fx: finiteNumber(intrinsics.fx, "fx"),
    fy: finiteNumber(intrinsics.fy, "fy"),
    cx: finiteNumber(intrinsics.cx, "cx"),
    cy: finiteNumber(intrinsics.cy, "cy"),
    width: intrinsics.width,
    height: intrinsics.height,
    distortion_model: intrinsics.distortion_model,
    distortion: intrinsics.distortion.map((value, i) =>
      finiteNumber(value, `distortion[${i}]`),
    ),
  };
}

function decodeIntrinsics(data: Record<string, unknown>): Intrinsics {
  const distortion_model = requireString(data, "distortion_model");
  if (!DISTORTION_MODELS.includes(distortion_model as DistortionModel)) {
    throw new Error("intrinsics.distortion_model must be none, plumb_bob, or equidistant");
  }
  const distortionRaw = requireKey(data, "distortion");
  if (!Array.isArray(distortionRaw)) {
    throw new Error("intrinsics.distortion must be a list");
  }
  return requireIntrinsics({
    fx: finiteField(data, "fx"),
    fy: finiteField(data, "fy"),
    cx: finiteField(data, "cx"),
    cy: finiteField(data, "cy"),
    width: requireInteger(data, "width"),
    height: requireInteger(data, "height"),
    distortion_model: distortion_model as DistortionModel,
    distortion: distortionRaw.map((value, i) => finiteNumber(value, `distortion[${i}]`)),
  });
}

function decodeHello(data: Record<string, unknown>): Hello {
  const timeSyncRaw = asObject(requireKey(data, "time_sync"), "time_sync");
  const time_sync: TimeSync = {
    ts_client: finiteField(timeSyncRaw, "ts_client"),
    ts_server: finiteField(timeSyncRaw, "ts_server"),
  };
  return {
    type: "hello",
    client_id: requireString(data, "client_id"),
    time_sync,
    robot: decodeRobot(asObject(requireKey(data, "robot"), "robot")),
    capabilities: decodeCapabilities(asObject(requireKey(data, "capabilities"), "capabilities")),
  };
}

function decodeRobot(data: Record<string, unknown>): RobotDescription {
  const footprint = requireNumberArray(data, "footprint_m", 2);
  return {
    display_name: requireString(data, "display_name"),
    body_bounds_m: requireVec3(data, "body_bounds_m"),
    footprint_m: [footprint[0], footprint[1]],
    base_height_m: finiteField(data, "base_height_m"),
  };
}

function decodeCapabilities(data: Record<string, unknown>): Capabilities {
  const capabilities = {} as Capabilities;
  for (const name of CAPABILITY_NAMES) {
    if (!(name in data)) {
      throw new Error(`Missing required field: capabilities.${name}`);
    }
    capabilities[name] = decodeCapability(data[name], name);
  }
  return capabilities;
}

function decodeCapability(raw: unknown, name: CapabilityName): Capability {
  const data = asObject(raw, `capabilities.${name}`);
  if (typeof data.available !== "boolean") {
    throw new Error(`Field 'capabilities.${name}.available' must be boolean`);
  }
  if (!Object.prototype.hasOwnProperty.call(data, "reason")) {
    throw new Error(`Missing required field: capabilities.${name}.reason`);
  }
  if (data.available) {
    if (data.reason !== null) {
      throw new Error("available capability must have reason=null");
    }
    return { available: true, reason: null };
  }
  if (typeof data.reason !== "string" || data.reason.length === 0) {
    throw new Error("unavailable capability requires a reason");
  }
  return { available: false, reason: data.reason };
}

function decodeState(data: Record<string, unknown>): State {
  const server = asObject(requireKey(data, "server"), "server");
  const connectedClients = requireInteger(server, "connected_clients");
  if (connectedClients < 0) {
    throw new Error("Field 'connected_clients' must be non-negative");
  }
  return {
    type: "state",
    server: { connected_clients: connectedClients },
    lidar: requireLidarSettings(
      decodeLidarSettings(asObject(requireKey(data, "lidar"), "lidar")),
    ),
    nav: decodeNavState(asObject(requireKey(data, "nav"), "nav")),
  };
}

function decodeLidarSettings(data: Record<string, unknown>): LidarSettings {
  return {
    enabled: requireBoolean(data, "enabled"),
    min_height_m: finiteField(data, "min_height_m"),
    max_height_m: finiteField(data, "max_height_m"),
    max_range_m: finiteField(data, "max_range_m"),
  };
}

function decodeNavState(data: Record<string, unknown>): NavState {
  const state = requireString(data, "state");
  if (state !== "idle" && state !== "following_path" && state !== "resolved") {
    throw new Error("nav.state must be idle, following_path, or resolved");
  }
  const outcome = requireKey(data, "outcome");
  if (state === "resolved") {
    if (outcome !== "succeeded" && outcome !== "failed") {
      throw new Error("nav.outcome must be succeeded or failed when nav.state is resolved");
    }
    return { state: "resolved", outcome };
  }
  if (outcome !== null) {
    throw new Error("nav.outcome must be null unless nav.state is resolved");
  }
  return { state, outcome: null };
}

function decodeLocalizationObservationsRequest(
  data: Record<string, unknown>,
): LocalizationObservationsRequest {
  const capturePolicy = requireString(data, "capture_policy");
  if (!isCapturePolicy(capturePolicy)) {
    throw new Error("capture_policy must be robot_los_required, robot_los_preferred, or any_angle");
  }
  const observationCount = requireInteger(data, "observation_count");
  if (observationCount < 1) {
    throw new Error(`observation_count must be at least 1, got ${observationCount}`);
  }
  const hasTimeout = Object.prototype.hasOwnProperty.call(data, "wait_timeout_s");
  if (capturePolicy === "robot_los_preferred") {
    if (!hasTimeout) {
      throw new Error("wait_timeout_s is required when capture_policy is robot_los_preferred");
    }
    const waitTimeoutS = finiteField(data, "wait_timeout_s");
    if (waitTimeoutS < 0) {
      throw new Error(`wait_timeout_s must be finite and non-negative, got ${waitTimeoutS}`);
    }
    return {
      type: "localization_observations_request",
      capture_policy: capturePolicy,
      observation_count: observationCount,
      wait_timeout_s: waitTimeoutS,
    };
  }
  if (hasTimeout) {
    throw new Error("wait_timeout_s is only valid for robot_los_preferred");
  }
  return {
    type: "localization_observations_request",
    capture_policy: capturePolicy,
    observation_count: observationCount,
  };
}

function decodeLocalizationResult(data: Record<string, unknown>): LocalizationResult {
  const confidence = finiteField(data, "confidence");
  if (confidence < 0 || confidence > 1) {
    throw new Error("Field 'confidence' must be in [0, 1]");
  }
  return {
    type: "localization_result",
    position: requireVec3(data, "position"),
    orientation: requireQuat(data, "orientation"),
    confidence,
    ts: finiteField(data, "ts"),
  };
}

function decodePose(data: Record<string, unknown>): Pose {
  return {
    type: "pose",
    position: requireVec3(data, "position"),
    orientation: requireQuat(data, "orientation"),
    ts: finiteField(data, "ts"),
  };
}

function decodeNavGoal(data: Record<string, unknown>): NavGoal {
  const pathRaw = requireKey(data, "path_poses");
  if (!Array.isArray(pathRaw)) {
    throw new Error("Field 'path_poses' must be array");
  }
  const path_poses = pathRaw.map((entry, i) => requireYawPoseValue(entry, `path_poses[${i}]`));
  const hasPose = Object.prototype.hasOwnProperty.call(data, "pose");
  if (path_poses.length === 0) {
    if (hasPose) {
      throw new Error("nav_goal.pose must be omitted when path_poses is empty");
    }
    return { type: "nav_goal", pose: null, path_poses, ts: finiteField(data, "ts") };
  }
  if (!hasPose) {
    throw new Error("nav_goal.pose is required when path_poses is non-empty");
  }
  return {
    type: "nav_goal",
    pose: requireYawPoseValue(data.pose, "pose"),
    path_poses,
    ts: finiteField(data, "ts"),
  };
}

function requireLidarSettings(settings: LidarSettings): LidarSettings {
  const minHeight = finiteNumber(settings.min_height_m, "min_height_m");
  const maxHeight = finiteNumber(settings.max_height_m, "max_height_m");
  const maxRange = finiteNumber(settings.max_range_m, "max_range_m");
  if (typeof settings.enabled !== "boolean") {
    throw new Error("Field 'enabled' must be boolean");
  }
  if (minHeight > maxHeight) {
    throw new Error("min_height_m must be <= max_height_m");
  }
  return {
    enabled: settings.enabled,
    min_height_m: minHeight,
    max_height_m: maxHeight,
    max_range_m: maxRange,
  };
}

function requireKey(data: Record<string, unknown>, key: string): unknown {
  if (!(key in data)) {
    throw new Error(`Missing required field: ${key}`);
  }
  return data[key];
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(data: Record<string, unknown>, key: string): string {
  const value = requireKey(data, key);
  if (typeof value !== "string") {
    throw new Error(`Field '${key}' must be string`);
  }
  return value;
}

function requireBoolean(data: Record<string, unknown>, key: string): boolean {
  const value = requireKey(data, key);
  if (typeof value !== "boolean") {
    throw new Error(`Field '${key}' must be boolean`);
  }
  return value;
}

function finiteField(data: Record<string, unknown>, key: string): number {
  return finiteNumber(requireKey(data, key), key);
}

function finiteNumber(value: unknown, key: string): number {
  if (typeof value !== "number") {
    throw new Error(`Field '${key}' must be a number`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Field '${key}' must be finite`);
  }
  return value;
}

function requireInteger(data: Record<string, unknown>, key: string): number {
  const value = finiteField(data, key);
  if (!Number.isInteger(value)) {
    throw new Error(`Field '${key}' must be an integer`);
  }
  return value;
}

function requireNumberArray(
  data: Record<string, unknown>,
  key: string,
  length: number,
): number[] {
  const raw = requireKey(data, key);
  if (!Array.isArray(raw) || raw.length !== length) {
    throw new Error(`Field '${key}' must be a ${length}-element array`);
  }
  return raw.map((entry, i) => finiteNumber(entry, `${key}[${i}]`));
}

function requireVec3(data: Record<string, unknown>, key: string): Vec3 {
  const values = requireNumberArray(data, key, 3);
  return [values[0], values[1], values[2]];
}

function requireQuat(data: Record<string, unknown>, key: string): Quat {
  const values = requireNumberArray(data, key, 4);
  return [values[0], values[1], values[2], values[3]];
}

function requireVec3Value(value: Vec3, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Field '${key}' must be a 3-element array`);
  }
  return [
    finiteNumber(value[0], `${key}[0]`),
    finiteNumber(value[1], `${key}[1]`),
    finiteNumber(value[2], `${key}[2]`),
  ];
}

function requireQuatValue(value: Quat, key: string): Quat {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`Field '${key}' must be a 4-element quaternion [qx, qy, qz, qw]`);
  }
  return [
    finiteNumber(value[0], `${key}[0]`),
    finiteNumber(value[1], `${key}[1]`),
    finiteNumber(value[2], `${key}[2]`),
    finiteNumber(value[3], `${key}[3]`),
  ];
}

function requireYawPoseValue(value: unknown, key: string): YawPose {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`Field '${key}' must be a 4-element [x, y, z, yaw]`);
  }
  return [
    finiteNumber(value[0], `${key}[0]`),
    finiteNumber(value[1], `${key}[1]`),
    finiteNumber(value[2], `${key}[2]`),
    finiteNumber(value[3], `${key}[3]`),
  ];
}

function isCapturePolicy(value: string): value is CapturePolicy {
  return (CAPTURE_POLICIES as readonly string[]).includes(value);
}

function writeFloat32Vec(view: DataView, offset: number, values: number[]): void {
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(offset + i * 4, values[i], true);
  }
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      throw new Error("intrinsics JSON must be ASCII");
    }
    out[i] = code;
  }
  return out;
}
