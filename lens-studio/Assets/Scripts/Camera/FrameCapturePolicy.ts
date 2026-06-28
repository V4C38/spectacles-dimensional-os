import { AppPhase } from "../Core/AppState";
import { CaptureHint } from "../Bridge/BridgeDomain";
import { CaptureMode, CapturePolicy } from "./FrameCaptureController";

export interface FrameCapturePolicyInput {
  appPhase: AppPhase;
  worldFrameCommitted: boolean;
  baselineCaptureSessionActive: boolean;
  registrationCaptureHint: CaptureHint;
  forceOff: boolean;
}

export interface FrameCapturePolicyResult {
  mode: CaptureMode;
  policy: CapturePolicy;
}

export function computeFrameCapturePolicy(
  input: FrameCapturePolicyInput,
): FrameCapturePolicyResult {
  if (input.forceOff) {
    return { mode: "off", policy: "off" };
  }

  if (input.appPhase === "registration" && input.baselineCaptureSessionActive) {
    return { mode: "registration", policy: input.registrationCaptureHint };
  }

  if (input.appPhase === "runtime" && input.worldFrameCommitted) {
    return { mode: "runtime", policy: "off" };
  }

  return { mode: "off", policy: "off" };
}
