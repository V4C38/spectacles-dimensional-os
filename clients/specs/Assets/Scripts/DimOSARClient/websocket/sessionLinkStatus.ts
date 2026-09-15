import type { ARModuleSessionState } from "./arModuleSession";

export const NO_ROBOT_CONNECTED_LABEL = "- Disconnected -";

export type SessionLinkPhase = "disconnected" | "connecting" | "robotOffline" | "connected";

export type StatusTone = "error" | "warn" | "success" | "neutral" | "muted";

export interface StatusText {
  text: string;
  color: StatusTone;
}

export interface SessionLinkTransitionLog {
  hudText: string;
  hudColor: StatusTone;
  consoleText: string;
  consoleColor: StatusTone;
  hudDurationS?: number;
}

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
        color: "error",
      };
    case "connecting":
      return {
        text: "\n\n\nConnecting…",
        color: "error",
      };
    case "robotOffline":
      return {
        text: "\n\n\nConnected - Robot not connected",
        color: "warn",
      };
    case "connected":
      return {
        text: `\n\n\nConnected - ${displayName}`,
        color: "success",
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
      hudColor: "error",
      consoleText: "Disconnected",
      consoleColor: "error",
      hudDurationS: 3.0,
    };
  }
  if (prev === "connected" && next === "robotOffline") {
    return {
      hudText: "Robot disconnected",
      hudColor: "error",
      consoleText: "Robot disconnected",
      consoleColor: "error",
      hudDurationS: 3.0,
    };
  }
  if (prev === "robotOffline" && next === "connected") {
    return {
      hudText: "Robot connected",
      hudColor: "success",
      consoleText: "Robot connected",
      consoleColor: "success",
      hudDurationS: 2.0,
    };
  }
  return null;
}
