import type { ARModuleSessionState } from "./arModuleSession";

export const NO_ROBOT_CONNECTED_LABEL = "- Disconnected -";

export type SessionLinkPhase = "disconnected" | "connecting" | "robotOffline" | "connected";

export interface StatusText {
  text: string;
  color: vec4;
}

export interface SessionLinkTransitionLog {
  hudText: string;
  hudColor: vec4;
  consoleText: string;
  consoleColor: vec4;
  hudDurationS?: number;
}

export const COLOR_WHITE = new vec4(1, 1, 1, 1);
export const COLOR_SUCCESS = new vec4(0, 1, 0, 1);
export const COLOR_ERROR = new vec4(1, 0, 0, 1);
export const COLOR_WARN = new vec4(1, 0.85, 0, 1);

export function deriveSessionLinkPhase(view: ARModuleSessionState): SessionLinkPhase {
  if (view.connection === "disconnected" || view.connection === "failed") {
    return "disconnected";
  }
  if (view.connection === "connecting" || view.connection === "awaiting_hello") {
    return "connecting";
  }
  if (!view.pose) {
    return "robotOffline";
  }
  return "connected";
}

export function sessionLinkStatus(
  view: ARModuleSessionState,
  displayName: string = NO_ROBOT_CONNECTED_LABEL,
): StatusText {
  switch (deriveSessionLinkPhase(view)) {
    case "disconnected":
      return {
        text: `\n\n\n${NO_ROBOT_CONNECTED_LABEL}`,
        color: COLOR_ERROR,
      };
    case "connecting":
      return {
        text: "\n\n\nConnecting…",
        color: COLOR_ERROR,
      };
    case "robotOffline":
      return {
        text: "\n\n\nConnected - Robot not connected",
        color: COLOR_WARN,
      };
    case "connected":
      return {
        text: `\n\n\nConnected - ${displayName}`,
        color: COLOR_SUCCESS,
      };
  }
}

export function sessionLinkTransitionLog(
  prev: SessionLinkPhase,
  next: SessionLinkPhase,
): SessionLinkTransitionLog | null {
  if (prev === next) {
    return null;
  }
  if (next === "disconnected") {
    return {
      hudText: "Disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    };
  }
  if (prev === "connected" && next === "robotOffline") {
    return {
      hudText: "Robot disconnected",
      hudColor: COLOR_ERROR,
      consoleText: "Robot disconnected",
      consoleColor: COLOR_ERROR,
      hudDurationS: 3.0,
    };
  }
  if (prev === "robotOffline" && next === "connected") {
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
