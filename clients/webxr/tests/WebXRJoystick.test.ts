import { describe, expect, it, vi } from "vitest";
import { filterJoystick, isMenuButtonPressed, isTriggerPressed, WebXRJoystick } from "../src/navigation/WebXRJoystick";

describe("WebXRJoystick", () => {
  it("filters the deadzone and treats the menu button as button 4", () => {
    expect(filterJoystick({ x: 0.05, y: 0.02 })).toBeNull();
    const live = filterJoystick({ x: 1, y: 0 });
    expect(live?.x).toBeCloseTo(1);
    expect(isMenuButtonPressed([{ pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: true }])).toBe(true);
    expect(isTriggerPressed([{ pressed: true }])).toBe(true);
  });

  it("rate-limits commands and sends an explicit zero on release", () => {
    const sendText = vi.fn();
    const session = {
      view: () => ({
        connection: "ready",
        capabilities: {
          navigation: {
            available: true,
            nav_joystick: { available: true, reason: null },
            nav_goal: { available: true, reason: null },
          },
        },
      }),
      sendText,
    };
    const joystick = new WebXRJoystick(session as never);
    joystick.tick(1, { x: 1, y: 0 });
    joystick.tick(1.05, { x: 1, y: 0 });
    expect(sendText).toHaveBeenCalledOnce();
    joystick.tick(1.2, null);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(String(sendText.mock.calls[1][0])).toContain("nav_joystick_request");
  });
});
