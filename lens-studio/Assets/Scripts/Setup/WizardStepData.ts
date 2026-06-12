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
export type CalibrationPhase = "editing" | "ready" | "pendingCommit" | "complete";

export interface CalibrationViewState {
  mode: AlignmentMode;
  phase: CalibrationPhase;
  spectaclesTracking: boolean;
  robotTracking: boolean;
  observationCount: number;
  baselineM: number | null;
  bridgeMessage: string;
  currentQuality: number | null;
  bestQuality: number | null;
  statusMessage: string;
  statusColor: vec4;
  bridgeWaitStartedAt: number | null;
  /** Set when manual bridge wait times out; cleared on retry or candidate. */
  manualBridgeWaitFailed: boolean;
  /** Current stable-cluster size reported by the bridge (marker align only). */
  clusterSize: number | null;
  /** Minimum cluster size required to produce a candidate (bridge constant). */
  requiredSamples: number | null;
}

export interface WizardFooterState {
  nextLabel: string;
  nextStyle: string;
  nextInactive: boolean;
  showPrev: boolean;
  showManual: boolean;
  manualLabel: string;
  manualStyle: string;
  centerNext: boolean;
  widePrevOffset: boolean;
}

export const WIZARD_STEP_TITLES: string[] = [
  "Start Robot & Bridge",
  "Connect",
  "Calibrate",
];

export const CALIBRATE_DESCRIPTION_AUTO =
  "Look at the AprilTag on your robot.\nStand 1-3 m away and hold steady.";

export const CALIBRATE_DESCRIPTION_MANUAL =
  "Place the marker at the robot location & rotation.\nNo April Tag needed.";

export const WIZARD_STEP_DESCRIPTIONS: string[] = [
  "Power on your robot.\nRun ./start.sh in dimos-xr on your Mac.",
  "Enter your Mac's IP.\nSame Wi‑Fi for robot, Mac, and Spectacles.",
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
