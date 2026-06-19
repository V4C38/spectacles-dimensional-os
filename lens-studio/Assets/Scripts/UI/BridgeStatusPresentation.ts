import { BridgeLinkState } from "../Core/AppState";
import { ClockSyncState } from "../Bridge/BridgeConnectionManager";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
} from "./kit/UIKit";

// ================================================================
/** Maps BridgeStatusMessage to status text, color, and robot model labels. */
// ================================================================

export interface BridgeStatusPresentation {
  text: string;
  color: vec4;
}

export function getBridgeStatusPresentation(
  state: BridgeLinkState,
): BridgeStatusPresentation {
  switch (state) {
    case "disconnected":
      return {
        text: "\n\n\nBridge disconnected",
        color: COLOR_ERROR,
      };
    case "connectedNoRobot":
      return {
        text: "\n\n\nBridge connected - waiting for robot",
        color: COLOR_WARN,
      };
    case "connected":
      return {
        text: "\n\n\nBridge connected",
        color: COLOR_SUCCESS,
      };
  }
}

export function getBridgeStatusPresentationForConnect(
  state: BridgeLinkState,
  isConnecting: boolean,
): BridgeStatusPresentation {
  if (isConnecting && state === "disconnected") {
    return {
      text: "Connecting...",
      color: COLOR_ERROR,
    };
  }
  return getBridgeStatusPresentation(state);
}

export function getBridgeConnectDetailStatus(
  linkState: BridgeLinkState,
  clockSyncState: ClockSyncState,
): string | null {
  if (linkState === "disconnected" || linkState === "connectedNoRobot") {
    return null;
  }
  if (clockSyncState === "pending") {
    return "Syncing clock…";
  }
  if (clockSyncState === "failed") {
    return "Clock sync failed — reconnect or continue without alignment frames";
  }
  return null;
}
