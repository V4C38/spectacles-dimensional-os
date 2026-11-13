// Target sequence cumulatively acknowledges accepted pose/settings input; identical
// content preserves revision. Reset clears the group draft only after authorized,
// non-busy admission. These semantics require no extra wire fields (PROTOCOL.md).
import { utf8Bytes, validatedBulkArray } from "./BulkTransfer";
import { decodeManipulation, decodeFollowingTail } from "../manipulation/ManipulationProtocol";
import { type InteractionState, type InteractionResult, type InteractionAuthority, type InteractionTarget, type InteractionCredentials, CAPABILITY_NAMES, type Capabilities, type Capability, type CapturePolicy, type DistortionModel, type Intrinsics, type Lidar, type LidarSettings, type LocalizationObservation, type LocalizationObservations, type LocalizationObservationsRequest, type LocalizationResult, type MapAlignment, type MapContext, type LocalizationMapTransform, type LocalizationStatus, type NavGoal, type NavState, type Outbound, type Pose, type Quat, type RobotDescription, type State, type TimeSync, type Vec3, type YawPose, type Hello, type HelloRequest, type AgentMessage, type AgentSkill, type NavigationCapability } from "../ClientContracts";


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
    if (utf8Bytes(chunk) + utf8Bytes(this.buffer) > 32768) throw new Error("Control frame buffer exceeds budget");
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    if (utf8Bytes(this.buffer) > 16384 || lines.some(line => utf8Bytes(line) > 16384)) throw new Error("Control frame exceeds 16KiB");
    return lines.filter((line) => line.trim().length > 0);
  }
}

export function encodeHelloRequest(request: Omit<HelloRequest, "type" | "protocol_version">): string {
  return encodeText({
    type: "hello_request",
    ...(request.resume_token ? { resume_token: request.resume_token } : {}),
    protocol_version: 2,
    ts_client: finiteNumber(request.ts_client, "ts_client"),
  } satisfies HelloRequest);
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
  preview?: boolean;
  preview_id?: string;
  position: Readonly<Vec3>;
  orientation: Readonly<Quat>;
  epoch: string; lease_id: string; sequence: number;
}): string {
  if (request.preview !== undefined && typeof request.preview !== "boolean") throw new Error("Field 'preview' must be boolean");
  if (request.preview_id !== undefined && request.preview !== true) throw new Error("preview_id requires preview: true");
  return encodeText({
    type: "nav_goal_request",
    ...interactionCredentials(request),
    ...(request.preview === true ? { preview: true, ...previewIdentity(request.preview_id) } : {}),
    position: requireVec3Value(request.position, "position"),
    orientation: requireQuatValue(request.orientation, "orientation"),
  });
}

export function encodeNavJoystickRequest(command: {
  linear: Vec3;
  angular: Vec3;
  duration?: number;
  epoch: string; lease_id: string; sequence: number;
}): string {
  const linear = requireVec3Value(command.linear, "linear");
  const angular = requireVec3Value(command.angular, "angular");
  if (linear[2] !== 0) {
    throw new Error("linear.z must be 0");
  }
  if (angular[0] !== 0 || angular[1] !== 0) {
    throw new Error("angular.x and angular.y must be 0");
  }
  const body: Record<string, unknown> = {
    type: "nav_joystick_request",
    ...interactionCredentials(command),
    linear,
    angular,
  };
  if (command.duration !== undefined) {
    const duration = finiteNumber(command.duration, "duration");
    if (duration < 0 || duration > NAV_JOYSTICK_MAX_DURATION_S) {
      throw new Error(
        `duration must be in [0, ${NAV_JOYSTICK_MAX_DURATION_S}], got ${duration}`,
      );
    }
    if (duration !== 0) {
      body.duration = duration;
    }
  }
  return encodeText(body);
}

export function encodeLidarSettingsRequest(request: LidarSettings): string {
  return encodeText({
    type: "lidar_settings_request",
    ...requireLidarSettings(request),
  });
}

export const HUMAN_INPUT_MAX_CHARS = 4000;
export const NAV_JOYSTICK_MAX_DURATION_S = 2.0;

export function encodeClientPose(pose: {
  position: Readonly<Vec3>;
  orientation: Readonly<Quat>;
  ts: number;
}): string {
  return encodeText({
    type: "client_pose",
    position: requireVec3Value(pose.position, "position"),
    orientation: requireNonZeroQuatValue(pose.orientation, "orientation"),
    ts: finiteNumber(pose.ts, "ts"),
  });
}

export function encodeUserMessageRequest(text: string): string {
  if (typeof text !== "string") {
    throw new Error("Field 'text' must be string");
  }
  const stripped = text.trim();
  if (stripped.length === 0) {
    throw new Error("user_message_request.text must be non-blank");
  }
  if (text.length > HUMAN_INPUT_MAX_CHARS) {
    throw new Error(`user_message_request.text exceeds ${HUMAN_INPUT_MAX_CHARS} characters`);
  }
  return encodeText({ type: "user_message_request", text: stripped });
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

export interface DecodeContext { message_type: string; message_ts?: number; request_id?: string }
export class ProtocolDecodeError extends Error {
  constructor(readonly context: DecodeContext, detail: string, readonly excerpt?: string) { super(detail); this.name = "ProtocolDecodeError"; }
}
export function encodeClientError(report: import("../ClientContracts").ClientError): string {
  return encodeText(report);
}

export function decodeOutbound(text: string): Exclude<Outbound, Lidar> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Frame must be a JSON object");
  }
  return decodeOutboundObject(asObject(parsed, "Frame"));
}

export function decodeOutboundObject(data: Record<string, unknown>): Exclude<Outbound, Lidar> {
  const msgType = requireString(data, "type");

  try {
  switch (msgType) {
    case "manipulation_state":
    case "manipulation_result": return decodeManipulation(data);
    case "interaction_state": return decodeInteractionState(data);
    case "interaction_result": return decodeInteractionResult(data);
    case "hello":
      return decodeHello(data);
    case "state":
      return decodeState(data);
    case "localization_observations_request":
      return decodeLocalizationObservationsRequest(data);
    case "localization_result":
      return decodeLocalizationResult(data);
    case "localization_context":
      return { type: "localization_context", ...decodeMapContext(data),
        ...(data.reset === undefined ? {} : { reset: requireBoolean(data, "reset") }) };
    case "localization_map_transform":
      return decodeMapTransform(data);
    case "localization_status":
      return decodeLocalizationStatus(data);
    case "pose":
      return decodePose(data);
    case "agent_message":
      return decodeAgentMessage(data);
    case "agent_skill":
      return decodeAgentSkill(data);
    default:
      throw new Error(`Unknown outbound frame type: '${msgType}'`);
  }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const field = detail.split(":")[0];
    let section: string | undefined;
    if (/^[a-zA-Z_][\w]*(?:\.[\w]+)+$/.test(field)) {
      let value: unknown = data;
      for (const part of field.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
      if (value !== undefined) section = JSON.stringify({ field, value });
    }
    throw new ProtocolDecodeError({ message_type: msgType,
      ...(typeof data.ts === "number" && Number.isFinite(data.ts) ? { message_ts: data.ts } : {}),
      ...(typeof data.request_id === "string" ? { request_id: data.request_id.slice(0, 128) } : {}) },
      detail, section);
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
  if (!Number.isInteger(intrinsics.width) || !Number.isInteger(intrinsics.height) || intrinsics.width <= 0 || intrinsics.height <= 0) {
    throw new Error("intrinsics.width and height must be positive integers");
  }
  const fx = finiteNumber(intrinsics.fx, "fx"), fy = finiteNumber(intrinsics.fy, "fy");
  if (fx <= 0 || fy <= 0) throw new Error("intrinsics.fx and fy must be positive");
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
    fx,
    fy,
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

function decodeSource(data: Record<string, unknown>): NonNullable<Hello["source"]> {
  if (data.kind !== "recording") throw new Error("Invalid source kind");
  return { kind: "recording", read_only: requireBoolean(data, "read_only"), name: requireString(data, "name") };
}
function decodePlayback(data: Record<string, unknown>): NonNullable<State["playback"]> {
  if (data.state !== "playing" && data.state !== "ended") throw new Error("Invalid playback state");
  const elapsed_s = finiteField(data, "elapsed_s"), duration_s = finiteField(data, "duration_s");
  if (elapsed_s < 0 || duration_s < elapsed_s) throw new Error("Invalid playback progress");
  return { state: data.state, elapsed_s, duration_s };
}

function decodeHello(data: Record<string, unknown>): Hello {
  const timeSyncRaw = asObject(requireKey(data, "time_sync"), "time_sync");
  const time_sync: TimeSync = {
    ts_client: finiteField(timeSyncRaw, "ts_client"),
    ts_server: finiteField(timeSyncRaw, "ts_server"),
  };
  if (data.protocol_version !== 2) {
    throw new Error(`Incompatible ARModule protocol: expected version 2, received ${data.protocol_version ?? "missing"}. Update ARModule and the client together.`);
  }
  return {
    type: "hello",
    ...(data.source === undefined ? {} : { source: decodeSource(asObject(data.source, "source")) }),
    localization: decodeLocalizationProviders(asObject(requireKey(data, "localization"), "localization")),
    protocol_version: 2,
    bulk_url: requireString(data, "bulk_url"),
    bulk_token: requireString(data, "bulk_token"),
    bulk_epoch: requireString(data, "bulk_epoch"),
    client_id: requireString(data, "client_id"),
    resume_token: requireString(data, "resume_token"),
    odom_reference_id: requireString(data, "odom_reference_id"),
    ...(data.server_info === undefined ? {} : { server_info: decodeServerInfo(asObject(data.server_info, "server_info")) }),
    time_sync,
    robot: decodeRobot(asObject(requireKey(data, "robot"), "robot")),
    capabilities: decodeCapabilities(asObject(requireKey(data, "capabilities"), "capabilities")),
  };
}

function decodeLocalizationProviders(data: Record<string, unknown>): NonNullable<Hello["localization"]> {
  const raw = requireKey(data, "providers");
  if (!Array.isArray(raw)) throw new Error("localization.providers must be an array");
  const providers: NonNullable<Hello["localization"]>["providers"] = [];
  for (const provider of raw) {
    if (provider !== "fiducial_marker" && provider !== "vps")
      throw new Error("localization.providers must contain fiducial_marker or vps");
    if (providers.includes(provider)) throw new Error("localization.providers must not contain duplicates");
    providers.push(provider);
  }
  return { providers };
}

function decodeServerInfo(data: Record<string, unknown>): { robot_ip?: string; dimos_version?: string; armodule_version?: string } {
  const info: { robot_ip?: string; dimos_version?: string; armodule_version?: string } = {};
  for (const key of ["robot_ip", "dimos_version", "armodule_version"] as const) {
    if (data[key] !== undefined) info[key] = requireString(data, key);
  }
  return info;
}

function decodeRobot(data: Record<string, unknown>): RobotDescription {
  const footprint = requireNumberArray(data, "footprint_m", 2);
  const scale = finiteField(data, "odom_scale_correction_factor");
  if (scale <= 0) {
    throw new Error("robot.odom_scale_correction_factor must be finite and positive");
  }
  return {
    display_name: requireString(data, "display_name"),
    body_bounds_m: requireVec3(data, "body_bounds_m"),
    footprint_m: [footprint[0], footprint[1]],
    base_height_m: finiteField(data, "base_height_m"),
    odom_scale_correction_factor: scale,
  };
}

function decodeCapabilities(data: Record<string, unknown>): Capabilities {
  const capabilities = {} as Capabilities;
  for (const name of CAPABILITY_NAMES) {
    if (!(name in data)) {
      throw new Error(`Missing required field: capabilities.${name}`);
    }
    if (name === "navigation") {
      capabilities.navigation = decodeNavigationCapability(data[name]);
    } else {
      capabilities[name] = decodeCapability(data[name], name);
    }
  }
  return capabilities;
}

function decodeNavigationCapability(raw: unknown): NavigationCapability {
  const data = asObject(raw, "capabilities.navigation");
  const base = decodeCapability(raw, "navigation");
  return {
    ...base,
    nav_goal: { ...decodeCapability(data.nav_goal, "navigation.nav_goal"), preview: requireBoolean(asObject(data.nav_goal, "navigation.nav_goal"), "preview") },
    nav_joystick: decodeCapability(data.nav_joystick, "navigation.nav_joystick"),
  };
}

function decodeCapability(raw: unknown, name: string): Capability {
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
    ...(data.playback === undefined ? {} : { playback: decodePlayback(asObject(data.playback, "playback")) }),
    server: { connected_clients: connectedClients },
    ...(data.nav_preview_costmap_ts === undefined ? {} : { nav_preview_costmap_ts: finiteField(data, "nav_preview_costmap_ts") }),
    lidar: requireLidarSettings(
      decodeLidarSettings(asObject(requireKey(data, "lidar"), "lidar")),
    ),
    nav: decodeNavState(asObject(requireKey(data, "nav"), "nav")),
    agent: decodeAgentState(asObject(requireKey(data, "agent"), "agent")),
  };
}

function decodeAgentState(data: Record<string, unknown>): { idle: boolean } {
  return { idle: requireBoolean(data, "idle") };
}

function decodeAgentMessage(data: Record<string, unknown>): AgentMessage {
  const text = requireString(data, "text").trim();
  if (text.length === 0) {
    throw new Error("agent_message.text must be non-blank");
  }
  return { type: "agent_message", text };
}

function decodeAgentSkill(data: Record<string, unknown>): AgentSkill {
  const name = requireString(data, "name").trim();
  if (name.length === 0) {
    throw new Error("agent_skill.name must be non-blank");
  }
  const args = requireKey(data, "args");
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("agent_skill.args must be a JSON object");
  }
  return { type: "agent_skill", name, args: args as Record<string, unknown> };
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
  // Mixed-mode robot/tag batches can also align directly in odom after a VPS
  // miss; episode purpose does not imply that a map anchor already exists.
  const capturePolicy = requireString(data, "capture_policy");
  if (!isCapturePolicy(capturePolicy)) {
    throw new Error("capture_policy must be robot_los_required, robot_los_preferred, or any_angle");
  }
  const observationCount = requireInteger(data, "observation_count");
  if (observationCount < 1) {
    throw new Error(`observation_count must be at least 1, got ${observationCount}`);
  }
  const resultTimeoutS = finiteField(data, "result_timeout_s");
  if (resultTimeoutS <= 0) {
    throw new Error("result_timeout_s must be finite and positive");
  }
  const episode = data.episode_id === undefined ? {} : {
    episode_id: boundedString(data, "episode_id"),
    purpose: requireString(data, "purpose") as "robot" | "headset",
  };
  if ("purpose" in episode && episode.purpose !== "robot" && episode.purpose !== "headset") throw new Error("invalid capture purpose");
  const captureId = boundedString(data, "capture_id");
  if (!captureId.trim()) throw new Error("invalid capture_id");
  const capture = { capture_id: captureId };
  const resultTimeout = { ...episode, ...capture, result_timeout_s: resultTimeoutS };
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
      ...resultTimeout,
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
    ...resultTimeout,
  };
}

function boundedString(data: Record<string, unknown>, key: string): string {
  const value = requireString(data, key);
  if (!value.length || value.length > 128) throw new Error(`invalid ${key}`);
  return value;
}
function decodeMapContext(data: Record<string, unknown>): MapContext {
  return { map_code: boundedString(data, "map_code"), odom_reference_id: boundedString(data, "odom_reference_id") };
}
function mapPose(data: Record<string, unknown>) {
  const confidence = finiteField(data, "confidence");
  if (confidence < 0 || confidence > 1) throw new Error("invalid map confidence");
  return { position: requireVec3(data, "position"), orientation: requireQuat(data, "orientation"), confidence, ts: finiteField(data, "ts") };
}
function decodeMapTransform(data: Record<string, unknown>): LocalizationMapTransform {
  const revision = requireInteger(data, "revision");
  if (revision < 0) throw new Error("invalid map revision");
  return { type: "localization_map_transform", ...decodeMapContext(data), ...mapPose(data), revision };
}
function decodeMapAlignment(data: Record<string, unknown>): MapAlignment {
  const travel = finiteField(data, "travel_m");
  if (travel < 0) throw new Error("invalid alignment travel");
  return { ...decodeMapContext(data), ...mapPose(data), id: boundedString(data, "id"),
    tracking_reference_id: boundedString(data, "tracking_reference_id"), travel_m: travel };
}
function decodeLocalizationStatus(data: Record<string, unknown>): LocalizationStatus {
  const scope = requireString(data, "scope"), status = requireString(data, "status");
  if (scope !== "robot" && scope !== "headset") throw new Error("invalid localization scope");
  if (status !== "succeeded" && status !== "failed" && status !== "deferred") throw new Error("invalid localization status");
  const retry = data.retry_after_s === undefined ? undefined : finiteField(data, "retry_after_s");
  if (retry !== undefined && retry < 0) throw new Error("invalid retry delay");
  return { type: "localization_status", ...decodeMapContext(data), scope, status,
    ...(retry === undefined ? {} : { retry_after_s: retry }),
    reason: requireString(data, "reason"),
    ...(data.episode_id === undefined ? {} : { episode_id: boundedString(data, "episode_id") }),
    ...(data.ts === undefined ? {} : { ts: finiteField(data, "ts") }) };
}

function decodeLocalizationResult(data: Record<string, unknown>): LocalizationResult {
  if ((data.map_alignment === undefined) !== (data.map_transform === undefined)) throw new Error("Map alignment requires its transform snapshot");
  // Rigid metric T_odom_client. The server corrects robot odometry before
  // localization; measured client positions and marker mounts are never scaled.
  const confidence = finiteField(data, "confidence");
  if (confidence < 0 || confidence > 1) {
    throw new Error("Field 'confidence' must be in [0, 1]");
  }
  return {
    type: "localization_result",
    ...(data.map_alignment === undefined ? {} : {
      map_alignment: decodeMapAlignment(asObject(data.map_alignment, "map_alignment")),
      map_transform: decodeMapTransform(asObject(data.map_transform, "map_transform")),
    }),
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

function optionalBoolean(data: Record<string, unknown>, key: string): boolean {
  if (data[key] === undefined) return false;
  if (typeof data[key] !== "boolean") throw new Error(`Field '${key}' must be boolean`);
  return data[key];
}

function previewIdentity(value: unknown): { preview_id?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.length < 1 || value.length > 128) throw new Error("preview_id must contain 1 to 128 characters");
  return { preview_id: value };
}

function decodeNavGoal(data: Record<string, unknown>, acceptedEndpoint = false): NavGoal {
  const preview = optionalBoolean(data, "preview");
  const identity = previewIdentity(data.preview_id);
  if (data.preview_id !== undefined && !preview) throw new Error("preview_id requires preview: true");
  const pathRaw = requireKey(data, "path_poses");
  if (!Array.isArray(pathRaw)) {
    throw new Error("Field 'path_poses' must be array");
  }
  const path_poses = validatedBulkArray(pathRaw) ? pathRaw as YawPose[] : pathRaw.map((entry, i) => requireYawPoseValue(entry, `path_poses[${i}]`));
  const hasPose = Object.prototype.hasOwnProperty.call(data, "pose");
  if (path_poses.length === 0) {
    if (hasPose && acceptedEndpoint && !preview) {
      return { type: "nav_goal", pose: requireYawPoseValue(data.pose, "pose"), path_poses, ts: finiteField(data, "ts") };
    }
    if (hasPose) {
      throw new Error("nav_goal.pose must be omitted when path_poses is empty");
    }
    return { type: "nav_goal", pose: null, path_poses, ts: finiteField(data, "ts"), ...(preview ? { preview, ...identity } : {}) };
  }
  if (!hasPose) {
    throw new Error("nav_goal.pose is required when path_poses is non-empty");
  }
  return {
    type: "nav_goal",
    ...(preview ? { preview, ...identity } : {}),
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
  return requireQuatValue([values[0], values[1], values[2], values[3]], key);
}

function requireVec3Value(value: Readonly<Vec3>, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Field '${key}' must be a 3-element array`);
  }
  return [
    finiteNumber(value[0], `${key}[0]`),
    finiteNumber(value[1], `${key}[1]`),
    finiteNumber(value[2], `${key}[2]`),
  ];
}

function requireQuatValue(value: Readonly<Quat>, key: string): Quat {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`Field '${key}' must be a 4-element quaternion [qx, qy, qz, qw]`);
  }
  const orientation: Quat = [
    finiteNumber(value[0], `${key}[0]`),
    finiteNumber(value[1], `${key}[1]`),
    finiteNumber(value[2], `${key}[2]`),
    finiteNumber(value[3], `${key}[3]`),
  ];
  if (Math.hypot(...orientation) < 1e-6) throw new Error(`Field '${key}' must be a non-zero quaternion`);
  return orientation;
}

function requireNonZeroQuatValue(value: Readonly<Quat>, key: string): Quat {
  return requireQuatValue(value, key);
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
    if (!Number.isFinite(Math.fround(values[i]))) throw new Error("camera pose must fit finite float32 components");
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

function interactionCredentials(value: InteractionCredentials): InteractionCredentials {
  if (!value.epoch || !value.lease_id || !Number.isInteger(value.sequence) || value.sequence! < 0) throw new Error("Invalid interaction authority credentials");
  return { epoch: value.epoch, lease_id: value.lease_id, sequence: value.sequence };
}
function nonnegativeInteger(data: Record<string, unknown>, key: string): number {
  const n = requireInteger(data, key); if (n < 0) throw new Error(`${key} must be nonnegative`); return n;
}
function decodeInteractionState(data: Record<string, unknown>): InteractionState {
  const mode = requireString(data, "mode");
  if (mode !== "manual" && mode !== "agent") throw new Error("Invalid interaction mode");
  let authority: InteractionAuthority | null = null;
  if (data.authority !== null) {
    const a = asObject(data.authority, "authority"), kind = requireString(a, "kind");
    if (!["live", "navigation_planning", "joystick", "manipulation_planning", "manipulation_following"].includes(kind)) throw new Error("Invalid interaction kind");
    authority = { client_id: requireString(a, "client_id"), source_id: requireString(a, "source_id"),
      acquisition_id: requireString(a, "acquisition_id"), lease_id: requireString(a, "lease_id"),
      kind: kind as InteractionAuthority["kind"], held: requireBoolean(a, "held"),
      expires_at: finiteField(a, "expires_at"), sequence: interactionSequence(a),
      ...(a.group_id == null ? {} : { group_id: requireString(a, "group_id") }) };
  }
  const targets = (() => {
    if (!Array.isArray(data.targets)) throw new Error("targets must be an array");
    return data.targets.map(t => decodeInteractionTarget(asObject(t, "target")));
  })();
  return { type: "interaction_state", epoch: requireString(data, "epoch"), revision: nonnegativeInteger(data, "revision"),
    mode, authority, targets, preview: data.preview == null ? null : decodeNavGoal(asObject(data.preview, "preview")),
    motion_busy: requireBoolean(data, "motion_busy"),
    following_tail: decodeFollowingTail(requireKey(data, "following_tail")),
    active_goal: data.active_goal == null ? null : decodeNavGoal(asObject(data.active_goal, "active_goal"), true) };
}
function decodeInteractionResult(data: Record<string, unknown>): InteractionResult {
  const status = requireString(data, "status");
  if (!["accepted", "busy", "stale", "rejected"].includes(status)) throw new Error("Invalid interaction result");
  return { type: "interaction_result", request_id: requireString(data, "request_id"),
    epoch: requireString(data, "epoch"), revision: nonnegativeInteger(data, "revision"),
    status: status as InteractionResult["status"], code: requireString(data, "code"),
    ...(data.lease_id === undefined ? {} : { lease_id: requireString(data, "lease_id") }) };
}

// Manipulation results may carry optional failed_joints identifiers for segment feedback.

// Revision-bound manipulation_state.evaluation supplies observational IK previews;
// only a checked plan can authorize execution.
// Manipulation observations optionally carry joint_velocities and gripper_target;
// execution_phase (motion/gripper) resolves before the single terminal outcome.
// See dimos-ar/PROTOCOL.md and ManipulationProtocol.ts for validation.
function interactionSequence(data: Record<string, unknown>): number { const n = requireInteger(data, "sequence"); if (n < -1) throw new Error("Invalid interaction sequence"); return n; }

function decodeInteractionTarget(a: Record<string, unknown>): InteractionTarget {
  const phase = requireString(a, "phase");
  if (!["draft", "live", "committed"].includes(phase)) throw new Error("Invalid target phase");
  const domain = requireString(a, "domain");
  if (domain !== "navigation" && domain !== "manipulation") throw new Error("Invalid target domain");
  const speed = a.speed_scale === undefined ? undefined : finiteField(a, "speed_scale");
  const gripper = a.gripper === undefined ? undefined : finiteField(a, "gripper");
  if (speed !== undefined && (speed <= 0 || speed > 1) || gripper !== undefined && (gripper < 0 || gripper > 1)) throw new Error("Invalid target settings");
  return { position: requireVec3(a, "position"), orientation: requireQuat(a, "orientation"),
    revision: nonnegativeInteger(a, "revision"), phase: phase as InteractionTarget["phase"],
    sample_ts: finiteField(a, "sample_ts"), sequence: interactionSequence(a),
    domain: domain as InteractionTarget["domain"],
    ...(a.group_id === undefined ? {} : { group_id: requireString(a, "group_id") }),
    ...(speed === undefined ? {} : { speed_scale: speed }), ...(gripper === undefined ? {} : { gripper }) };
}
