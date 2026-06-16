import { COLOR_ERROR, COLOR_SUCCESS } from "../UI/kit/UIKit";

export interface AssistPreviewPresentation {
  progress: number;
  titleText: string;
  statusText: string;
  statusColor: vec4;
}

export interface AssistPreviewInput {
  assistStage?: string;
  progress: number;
  tagVisible: boolean;
}

const AWAITING_CONFIRM_PROGRESS = 20;
const MOVE_LEG_ONE_PROGRESS = 17;
const MOVE_LEG_TWO_PROGRESS = 50;
const MOVE_LEG_THREE_PROGRESS = 83;

export function isAssistPreviewStage(assistStage?: string): boolean {
  return assistStage === "awaiting_confirm" || assistStage === "move";
}

export function isAssistMoveStage(assistStage?: string): boolean {
  return assistStage === "move";
}

export function buildAssistPreviewPresentation(
  input: AssistPreviewInput,
): AssistPreviewPresentation {
  const progress = computeAssistPreviewProgress(input);
  return {
    progress,
    titleText: `Progress: ${progress}%`,
    statusText: input.tagVisible ? "✅ Tag visible" : "❌ Tag not visible - Look at the tag",
    statusColor: input.tagVisible ? COLOR_SUCCESS : COLOR_ERROR,
  };
}

export function computeAssistPreviewProgress(input: AssistPreviewInput): number {
  const clamped = Math.max(0, Math.min(100, Math.round(input.progress)));
  if (input.assistStage === "awaiting_confirm") {
    return Math.max(clamped, AWAITING_CONFIRM_PROGRESS);
  }
  if (input.assistStage === "move") {
    if (clamped >= 100) {
      return 100;
    }
    if (clamped >= 66) {
      return Math.max(clamped, MOVE_LEG_THREE_PROGRESS);
    }
    if (clamped >= 33) {
      return Math.max(clamped, MOVE_LEG_TWO_PROGRESS);
    }
    return Math.max(clamped, MOVE_LEG_ONE_PROGRESS);
  }
  return clamped;
}
