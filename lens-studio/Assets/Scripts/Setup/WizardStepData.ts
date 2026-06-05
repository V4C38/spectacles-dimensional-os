// ================================================================
/** Wizard step enum, calibration view state types, and step copy constants. */
// ================================================================

export enum WizardStep {
  Start = 0,
  Connect = 1,
  Calibrate = 2,
}

export const LAST_WIZARD_STEP = WizardStep.Calibrate;

export type AlignmentMode = "auto" | "manual";

export interface CalibrationViewState {
  mode: AlignmentMode;
  spectaclesTracking: boolean;
  robotTracking: boolean;
  currentQuality: number | null;
  bestQuality: number | null;
  hasCandidate: boolean;
  pendingCommit: boolean;
  statusMessage: string;
  statusColor: vec4;
}

export interface WizardFooterState {
  nextLabel: string;
  nextStyle: string;
  nextInactive: boolean;
  showPrev: boolean;
  showManual: boolean;
  manualLabel: string;
  centerNext: boolean;
  widePrevOffset: boolean;
}

export const WIZARD_STEP_TITLES: string[] = [
  "Start Robot & DimOS",
  "Connect DimOS WebSocket",
  "Calibrate coordinates",
];

export const CALIBRATE_DESCRIPTION_AUTO =
  "Open the DimOS QR code on your phone.\nHold the marker where the robot camera and Spectacles can both see it.";

export const CALIBRATE_DESCRIPTION_MANUAL =
  "Move the robot marker to approximately where the robot stands. No QR code or phone needed.";

export const WIZARD_STEP_DESCRIPTIONS: string[] = [
  "Power up your robot (Go2 / G1) and wait for it to boot.\nOn your Mac, open the dimos-ar folder and run ./start.sh to launch the bridge.",
  "Enter your PC's local IP to connect.\nKeep the robot, your PC, and Spectacles on the same local network.",
  CALIBRATE_DESCRIPTION_AUTO,
];

export function wizardStepName(step: WizardStep): string {
  switch (step) {
    case WizardStep.Start:
      return "start";
    case WizardStep.Connect:
      return "connect";
    case WizardStep.Calibrate:
      return "calibrate";
    default:
      return "unknown";
  }
}
