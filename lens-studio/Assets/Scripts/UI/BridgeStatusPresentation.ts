import { BridgeLinkState } from "../Core/AppState";
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
        text: "Bridge disconnected",
        color: COLOR_ERROR,
      };
    case "connectedNoRobot":
      return {
        text: "Bridge connected - waiting for robot",
        color: COLOR_WARN,
      };
    case "connected":
      return {
        text: "Bridge connected",
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
