import {CONTROL_PANEL_CONTROLS, CONTROL_PANEL_SCALE, CONTROL_PANEL_TYPE} from "./ControlPanelPresentation";

const compactControlScale = CONTROL_PANEL_SCALE.runtime / .7;
/** OpenYAM controls only; the robot badge is anchored independently. */
export const ARM_PANEL_STYLE = {
  widthM: 0.224, headerM: 0.04, rowM: 0.04, paddingM: 0.028,
  buttonHeightM: CONTROL_PANEL_CONTROLS.height * compactControlScale,
  buttonFontM: CONTROL_PANEL_TYPE.buttonDp * CONTROL_PANEL_TYPE.dpToMetres * compactControlScale,
  cornerM: .025,
  defaultScale: 0.875, minScale: 0.65625, maxScale: 1.75,
  pinXM: 0.088, pinYM: -0.024, pinSizeM: CONTROL_PANEL_CONTROLS.iconSize * compactControlScale, iconStrokeM: 0.0015,
} as const;
export function clampArmPanelScale(scale: number): number {
  return Math.max(ARM_PANEL_STYLE.minScale, Math.min(ARM_PANEL_STYLE.maxScale, scale));
}

/** Shared thumbtack icon, in design metres, as independent line-segment endpoints. */
export const PANEL_PIN_SEGMENTS: readonly (readonly [number, number])[] = [
 [-.005,.007],[.005,.007], [-.005,.007],[-.003,.001],
 [.005,.007],[.003,.001], [-.003,.001],[-.006,-.002],
 [-.006,-.002],[.006,-.002], [.006,-.002],[.003,.001],
 [0,-.002],[0,-.009],
];
export const PANEL_SCAN_SEGMENTS: readonly (readonly [number, number])[] = [
 [-.007,.003],[-.007,.007],[-.007,.007],[-.003,.007],
 [.003,.007],[.007,.007],[.007,.007],[.007,.003],
 [.007,-.003],[.007,-.007],[.007,-.007],[.003,-.007],
 [-.003,-.007],[-.007,-.007],[-.007,-.007],[-.007,-.003],
 [-.003,0],[.003,0],[0,-.003],[0,.003],
];
