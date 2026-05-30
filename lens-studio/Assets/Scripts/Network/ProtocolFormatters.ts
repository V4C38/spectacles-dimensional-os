import { BridgeStatusMessage } from "./ProtocolTypes";

export function formatBridgeStatus(msg: BridgeStatusMessage): string {
  const model = msg.robot_model.replace("unitree_", "").toUpperCase();
  const mode = msg.mode === "replay" ? "Replay" : "Live";

  if (msg.reconnecting) {
    return `${mode} · ${model} — reconnecting…`;
  }
  if (!msg.robot_connected) {
    return `${mode} · ${model} — robot not connected`;
  }

  const label = msg.robot_serial ?? msg.robot_id;
  const streams = msg.streams_active
    ? "data streaming"
    : "waiting for lidar/odom";
  const calibrated = msg.registered ? "calibrated" : "needs calibration";
  return `${mode} · ${model} (${label}) — ${streams}, ${calibrated}`;
}
