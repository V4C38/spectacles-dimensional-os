import type { InteractionAuthorityPort, Quat, Vec3 } from "../ClientContracts";
import { encodeNavGoalRequest, encodeNavJoystickRequest } from "../websocket/protocol";
import { requireNavigation, type ARModuleSession } from "../websocket/ARModuleSession";



export function requestNavGoal(
  session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort },
  goal: { position: Vec3; orientation: Quat },
): void {
  requireNavigation(session, "nav_goal");
  const credentials = session.collaboration.credentials();
  if (!credentials) throw new Error("Navigation requires grab authority");
  session.sendText(encodeNavGoalRequest({ ...goal, ...credentials }));
}


export function requestNavPreview(
  session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort },
  goal: { position: Vec3; orientation: Quat; preview_id: string },
): void {
  requireNavigation(session, "nav_goal");
  if (session.view().capabilities?.navigation.nav_goal.preview !== true) throw new Error("Navigation preview is unavailable");
  const credentials = session.collaboration.credentials();
  if (!credentials) throw new Error("Preview requires planning authority");
  session.sendText(encodeNavGoalRequest({ ...goal, ...credentials, preview: true }));
}

export function requestNavJoystick(
  session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort },
  command: { linear: Vec3; angular: Vec3; duration?: number },
): void {
  requireNavigation(session, "nav_joystick");
  const credentials = session.collaboration.credentials();
  if (!credentials) throw new Error("Joystick requires grab authority");
  session.sendText(encodeNavJoystickRequest({ ...command, ...credentials }));
}

export const JOYSTICK_DEADZONE = 0.15;
export const JOYSTICK_SEND_INTERVAL_S = 0.1;
export const JOYSTICK_LINEAR_MPS = 0.6;
export const JOYSTICK_YAW_RADPS = 0.8;
export type JoystickAxes = { x: number; y: number };

export function filterJoystick(axes: JoystickAxes): JoystickAxes | null {
  const magnitude = Math.hypot(axes.x, axes.y);
  if (magnitude < JOYSTICK_DEADZONE) {
    return null;
  }
  const scale = (magnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  return {
    x: (axes.x / magnitude) * Math.min(1, scale),
    y: (axes.y / magnitude) * Math.min(1, scale),
  };
}

export class JoystickNavigationController {
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private held = false;

  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort }) {
    if (!session.collaboration) throw new Error("Navigation requires interaction authority");
  }

  tick(now: number, axes: JoystickAxes | null): void {
    if (this.session.view().connection !== "ready" || this.session.view().capabilities?.navigation.nav_joystick.available !== true) {
      if (this.held) {
        this.sendZero();
        this.held = false;
      }
      return;
    }
    const filtered = axes ? filterJoystick(axes) : null;
    if (!filtered) {
      if (this.held) {
        this.sendZero();
        this.held = false;
      }
      return;
    }
    if (!this.session.collaboration.begin("joystick", "joystick")) return;
    this.held = true;
    if (!this.session.collaboration.snapshot().ownsAuthority) return;
    if (now - this.lastSentAt < JOYSTICK_SEND_INTERVAL_S) {
      this.held = true;
      return;
    }
    requestNavJoystick(this.session, {
      linear: [-filtered.y * JOYSTICK_LINEAR_MPS, 0, 0],
      angular: [0, 0, -filtered.x * JOYSTICK_YAW_RADPS],
    });
    this.lastSentAt = now;
    this.held = true;
  }

  loseInput(): void {
    if (this.held) {
      this.sendZero();
      this.held = false;
    }
  }

  private sendZero(): void {
    this.session.collaboration.release(undefined, ["joystick"]);
  }
}
