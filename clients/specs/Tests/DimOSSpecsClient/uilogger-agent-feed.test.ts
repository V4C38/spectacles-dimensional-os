import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEBUG_CONSOLE_SCROLL_LINE_COUNT,
  DEBUG_CONSOLE_TOTAL_LINE_COUNT,
  UILogger,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/UILogger";
import {
  createAgentSpeechSessionState,
  deriveAgentPromptEntry,
} from "../../Assets/Scripts/DimOSSpecsClient/agent/AgentSpeechSession";
import { classifyAgentResponseText } from "../../Assets/Scripts/DimOSSpecsClient/agent/AgentResponseClassification";

interface MockText {
  text: string;
  textFill: { color: { x: number; y: number; z: number; w: number } };
}

function createMockLines(): MockText[] {
  return Array.from({ length: DEBUG_CONSOLE_TOTAL_LINE_COUNT }, () => ({
    text: "",
    textFill: { color: { x: 0, y: 0, z: 0, w: 1 } },
  }));
}

describe("UILogger agent prompt/response feed", () => {
  let logger: UILogger;
  let lines: MockText[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
    logger = new UILogger();
    lines = createMockLines();
    logger.bindConsoleOutputLines(lines as unknown as Text[]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("feeds line 7 from ASR via deriveAgentPromptEntry", () => {
    const session = createAgentSpeechSessionState();
    const prompt = deriveAgentPromptEntry(session, "hello there");
    expect(prompt).toEqual({ text: "hello there", valid: false });
    logger.setAgentPrompt(prompt);
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.text).toBe(
      "[12:00:00] User ASR: hello there",
    );
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.textFill.color).toEqual({
      x: 1,
      y: 0.85,
      z: 0,
      w: 1,
    });

    const wake = deriveAgentPromptEntry(session, "agent go forward");
    expect(wake).toEqual({ text: "agent go forward", valid: true });
    logger.setAgentPrompt(wake);
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.text).toBe(
      "[12:00:00] User ASR: agent go forward",
    );
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.textFill.color).toEqual({
      x: 0,
      y: 1,
      z: 0,
      w: 1,
    });
  });

  it("feeds line 8 from agent text, idle, and classification", () => {
    const text = "On my way";
    logger.setAgentResponse({
      text,
      state: "busy",
      severity: classifyAgentResponseText(text),
    });
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.text).toBe(
      "[12:00:00] Agent response: On my way",
    );
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.textFill.color).toEqual({
      x: 1,
      y: 0.85,
      z: 0,
      w: 1,
    });

    logger.setAgentResponse({
      text,
      state: "idle",
      severity: classifyAgentResponseText(text),
    });
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.textFill.color).toEqual({
      x: 1,
      y: 1,
      z: 1,
      w: 1,
    });
  });

  it("clears both reserved lines on leave-agent-mode", () => {
    logger.setAgentPrompt({ text: "robot", valid: true });
    logger.setAgentResponse({
      text: "On my way",
      state: "idle",
      severity: "ok",
    });
    logger.setAgentPrompt(null);
    logger.setAgentResponse(null);
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.text).toBe("[12:00:00] User ASR: ...");
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.text).toBe(
      "[12:00:00] Agent response: ...",
    );
  });

  it("feeds ASR send failures as error responses", () => {
    logger.setAgentResponse({
      text: "command not sent (not ready)",
      state: "idle",
      severity: "error",
    });
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.text).toBe(
      "[12:00:00] Agent response: command not sent (not ready)",
    );
    expect(lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.textFill.color).toEqual({
      x: 1,
      y: 0,
      z: 0,
      w: 1,
    });
  });
});
