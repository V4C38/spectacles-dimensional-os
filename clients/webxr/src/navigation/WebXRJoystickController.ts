export { JoystickNavigationController as WebXRJoystickController, filterJoystick, JOYSTICK_DEADZONE, JOYSTICK_SEND_INTERVAL_S, JOYSTICK_LINEAR_MPS, JOYSTICK_YAW_RADPS } from "@dimos-ar-client/navigation/JoystickNavigationController";
export type { JoystickAxes } from "@dimos-ar-client/navigation/JoystickNavigationController";
export const TRIGGER_BUTTON_INDEX = 0;
export const MENU_BUTTON_INDEX = 4;
export function isTriggerPressed(buttons: ReadonlyArray<{ pressed: boolean }>): boolean { return buttons[TRIGGER_BUTTON_INDEX]?.pressed === true; }
export function isMenuButtonPressed(buttons: ReadonlyArray<{ pressed: boolean }>): boolean { return buttons[MENU_BUTTON_INDEX]?.pressed === true; }
