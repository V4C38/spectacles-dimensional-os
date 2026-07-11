// ================================================================
/** Bridge link HUD strings and connect-step presentation. */
// ================================================================

import {
  BridgeLinkState,
  NO_ROBOT_CONNECTED_LABEL,
  StatusTextPresentation,
} from "../AppState";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WARN } from "../UI/UIKit";

export interface BridgeLinkTransitionLog {
  hudText: string;
  hudColor: vec4;
  consoleText: string;
  consoleColor: vec4;
  hudDurationS?: number;
}

export interface BridgeConnectPresentationContext {
  linkState: BridgeLinkState;
  isConnecting: boolean;
  socketOpen: boolean;
  handshakeReady: boolean;
  clockSync: "idle" | "pending" | "ready" | "failed";
  displayName?: string;
}

export interface BridgeConnectPresentation {
  primary: StatusTextPresentation;
  detail: string | null;
}

/** Main HUD bridge connection line. */
export function bridgeLinkPresentation(
  linkState: BridgeLinkState,
  displayName: string = NO_ROBOT_CONNECTED_LABEL,
): StatusTextPresentation {
  switch (linkState) {
    case "disconnected":
      return {
        text: "\n\n\nBridge not connected",
        color: COLOR_ERROR,
      };
    case "connectedNoRobot":
      return {
        text: "\n\n\nBridge connected - Robot not connected",
        color: COLOR_WARN,
      };
    case "connected":
      return {
        text: `\n\n\nBridge connected - ${displayName}`,
        color: COLOR_SUCCESS,
      };
  }
}

/** Registration wizard connect step status. */
export function bridgeConnectPresentation(
  ctx: BridgeConnectPresentationContext,
): BridgeConnectPresentation {
  if (ctx.isConnecting && !ctx.socketOpen) {
    return {
      primary: { text: "Connecting to bridge…", color: COLOR_ERROR },
      detail: null,
    };
  }
  if (ctx.isConnecting && ctx.socketOpen && !ctx.handshakeReady) {
    return {
      primary: { text: "Waiting for handshake…", color: COLOR_ERROR },
      detail: null,
    };
  }
  if (ctx.isConnecting && ctx.linkState === "disconnected") {
    return {
      primary: { text: "Connecting...", color: COLOR_ERROR },
      detail: null,
    };
  }

  const primary = bridgeLinkPresentation(ctx.linkState, ctx.displayName);
  let detail: string | null = null;
  if (ctx.linkState !== "disconnected" && ctx.linkState !== "connectedNoRobot") {
    if (ctx.clockSync === "pending") {
      detail = "Syncing clock…";
    } else if (ctx.clockSync === "failed") {
      detail =
        "Clock sync failed — reconnect or continue without registration frames";
    }
  }
  return { primary, detail };
}

/** UILogger + HUD copy when bridgeLinkState changes (runtime). */
export function bridgeLinkTransitionLog(
  prev: BridgeLinkState,
  next: BridgeLinkState,
): BridgeLinkTransitionLog | null {
  if (prev === next) {
    return null;
  }
  if (next === "disconnected") {
    return {
      hudText: "Bridge disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Bridge disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    };
  }
  if (prev === "connected" && next === "connectedNoRobot") {
    return {
      hudText: "Robot disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Robot disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    };
  }
  if (prev === "connectedNoRobot" && next === "connected") {
    return {
      hudText: "Robot connected",
      hudColor: COLOR_SUCCESS,
      consoleText: "Robot connected",
      consoleColor: COLOR_SUCCESS,
      hudDurationS: 2.0,
    };
  }
  return null;
}
