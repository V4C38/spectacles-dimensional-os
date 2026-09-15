import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AGENT_PROMPT_PLACEHOLDER,
  AGENT_RESPONSE_PLACEHOLDER,
  DEBUG_CONSOLE_SCROLL_LINE_COUNT,
  DEBUG_CONSOLE_TOTAL_LINE_COUNT,
  UILogger,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/UILogger";

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

function agentPromptLine(lines: MockText[]): MockText {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT] ?? {
    text: "",
    textFill: { color: { x: 0, y: 0, z: 0, w: 1 } },
  };
}

function agentResponseLine(lines: MockText[]): MockText {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1] ?? {
    text: "",
    textFill: { color: { x: 0, y: 0, z: 0, w: 1 } },
  };
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

  it("renders an invalid ASR prompt in yellow and a valid one in green", () => {
    logger.setAgentPrompt({ text: "hello there", valid: false });
    expect(agentPromptLine(lines).text).toContain("hello there");
    expect(agentPromptLine(lines).textFill.color).toEqual({
      x: 1,
      y: 0.85,
      z: 0,
      w: 1,
    });

    logger.setAgentPrompt({ text: "agent go forward", valid: true });
    expect(agentPromptLine(lines).text).toContain("agent go forward");
    expect(agentPromptLine(lines).textFill.color).toEqual({
      x: 0,
      y: 1,
      z: 0,
      w: 1,
    });
  });

  it("renders busy agent text in yellow and idle text in white", () => {
    const text = "On my way";
    logger.setAgentResponse({
      text,
      state: "busy",
      severity: "ok",
    });
    expect(agentResponseLine(lines).text).toContain(text);
    expect(agentResponseLine(lines).textFill.color).toEqual({
      x: 1,
      y: 0.85,
      z: 0,
      w: 1,
    });

    logger.setAgentResponse({
      text,
      state: "idle",
      severity: "ok",
    });
    expect(agentResponseLine(lines).textFill.color).toEqual({
      x: 1,
      y: 1,
      z: 1,
      w: 1,
    });
  });

  it("restores placeholders when agent mode is left", () => {
    logger.setAgentPrompt({ text: "robot", valid: true });
    logger.setAgentResponse({
      text: "On my way",
      state: "idle",
      severity: "ok",
    });
    logger.setAgentPrompt(null);
    logger.setAgentResponse(null);
    expect(agentPromptLine(lines).text).toContain(AGENT_PROMPT_PLACEHOLDER);
    expect(agentResponseLine(lines).text).toContain(AGENT_RESPONSE_PLACEHOLDER);
  });

  it("renders send failures as error responses", () => {
    logger.setAgentResponse({
      text: "command not sent (not ready)",
      state: "idle",
      severity: "error",
    });
    expect(agentResponseLine(lines).text).toContain("command not sent (not ready)");
    expect(agentResponseLine(lines).textFill.color).toEqual({
      x: 1,
      y: 0,
      z: 0,
      w: 1,
    });
  });
});
