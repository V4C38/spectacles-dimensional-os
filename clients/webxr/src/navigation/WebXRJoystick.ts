import type { ARModuleSession } from "@dimos-ar-client/websocket/arModuleSession";
import { requestNavJoystick } from "@dimos-ar-client/navigation/navJoystickRequest";

export const JOYSTICK_DEADZONE = 0.15;
export const JOYSTICK_SEND_INTERVAL_S = 0.1;
export const JOYSTICK_LINEAR_MPS = 0.6;
export const JOYSTICK_YAW_RADPS = 0.8;
export const TRIGGER_BUTTON_INDEX = 0;
export const MENU_BUTTON_INDEX = 4;

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

export function isTriggerPressed(buttons: ReadonlyArray<{ pressed: boolean }>): boolean {
  return buttons[TRIGGER_BUTTON_INDEX]?.pressed === true;
}

export function isMenuButtonPressed(buttons: ReadonlyArray<{ pressed: boolean }>): boolean {
  return buttons[MENU_BUTTON_INDEX]?.pressed === true;
}

export class WebXRJoystick {
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private held = false;

  constructor(private readonly session: ARModuleSession) {}

  tick(now: number, axes: JoystickAxes | null): void {
    if (this.session.view().capabilities?.navigation.nav_joystick.available !== true) {
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
    if (now - this.lastSentAt < JOYSTICK_SEND_INTERVAL_S) {
      this.held = true;
      return;
    }
    requestNavJoystick(this.session, {
      linear: [filtered.y * JOYSTICK_LINEAR_MPS, 0, 0],
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
    try {
      requestNavJoystick(this.session, { linear: [0, 0, 0], angular: [0, 0, 0] });
    } catch {
      this.held = false;
    }
  }
}
