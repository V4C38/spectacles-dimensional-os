import { BridgeStatusMessage } from "../../Network/Protocol";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
} from "./UICore";

// ================================================================
/** Maps BridgeStatusMessage to status text, color, and robot model labels. */
// ================================================================

export interface BridgeStatusPresentation {
  text: string;
  color: vec4;
}

export function getBridgeStatusPresentation(
  msg: BridgeStatusMessage,
): BridgeStatusPresentation {
  if (msg.reconnecting) {
    return {
      text: "Bridge reconnecting",
      color: COLOR_WARN,
    };
  }
  if (!msg.robot_connected) {
    return {
      text: "Robot disconnected",
      color: COLOR_ERROR,
    };
  }
  if (!msg.streams_active) {
    return {
      text: "Robot connected - waiting for data",
      color: COLOR_WARN,
    };
  }
  if (!msg.registered) {
    return {
      text: "Robot data active - calibration needed",
      color: COLOR_WARN,
    };
  }
  return {
    text: "Robot data active",
    color: COLOR_SUCCESS,
  };
}

export function getRobotModelLabel(
  msg: BridgeStatusMessage | null | undefined,
): string {
  const raw = msg?.robot_id?.trim();
  if (!raw) {
    return "Unknown Hardware";
  }

  const normalized = raw.replace(/[-\s]+/g, "_").toLowerCase();
  if (normalized === "unitree_go2") {
    return "Unitree Go2";
  }
  if (normalized === "unitree_g1") {
    return "Unitree G1";
  }
  return "Unknown Hardware";
}

export function getRobotHardwareLabel(msg: BridgeStatusMessage): string {
  const id = msg.robot_id?.trim();
  return `HARDWARE [${id || "UNKNOWN"}]`;
}
