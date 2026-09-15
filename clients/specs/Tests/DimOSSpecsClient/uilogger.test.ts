import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AGENT_PROMPT_PLACEHOLDER,
  AGENT_RESPONSE_PLACEHOLDER,
  DEBUG_CONSOLE_SCROLL_LINE_COUNT,
  DEBUG_CONSOLE_TOTAL_LINE_COUNT,
  formatConsoleLine,
  formatConsoleTimestamp,
  UILogConsoleEntry,
  UILogger,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/UILogger";

interface MockText {
  text: string;
  textFill: { color: { x: number; y: number; z: number; w: number } };
}

function createMockText(): MockText {
  return {
    text: "",
    textFill: { color: { x: 0, y: 0, z: 0, w: 1 } },
  };
}

function createMockLines(count = DEBUG_CONSOLE_TOTAL_LINE_COUNT): MockText[] {
  return Array.from({ length: count }, () => createMockText());
}

function scrollLines(lines: MockText[]): MockText[] {
  return lines.slice(0, DEBUG_CONSOLE_SCROLL_LINE_COUNT);
}

function newestScroll(lines: MockText[]): MockText {
  const filled = scrollLines(lines).filter((line) => line.text !== "");
  return filled[filled.length - 1] ?? createMockText();
}

function findScroll(lines: MockText[], needle: string): MockText | undefined {
  return scrollLines(lines).find((line) => line.text.includes(needle));
}

function agentPromptLine(lines: MockText[]): MockText {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT] ?? createMockText();
}

function agentResponseLine(lines: MockText[]): MockText {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1] ?? createMockText();
}

function statusLineText(lines: MockText[]): string {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 2]?.text ?? "";
}

describe("formatConsoleTimestamp", () => {
  it("formats wall-clock time as [HH:MM:SS]", () => {
    const loggedAt = new Date(2026, 6, 3, 14, 5, 7);
    expect(formatConsoleTimestamp(loggedAt)).toBe("[14:05:07]");
  });
});

describe("formatConsoleLine", () => {
  it("prefixes message with timestamp", () => {
    const entry: UILogConsoleEntry = {
      text: "Websocket connected",
      color: new vec4(1, 1, 1, 1),
      loggedAt: new Date(2026, 6, 3, 9, 30, 0),
    };
    expect(formatConsoleLine(entry)).toBe("[09:30:00] Websocket connected");
  });
});

describe("UILogger console output", () => {
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

  it("renders the first message on the bottom scroll line", () => {
    logger.show("first", new vec4(1, 0, 0, 1));

    expect(newestScroll(lines).text).toContain("first");
    expect(scrollLines(lines).filter((line) => line.text !== "")).toHaveLength(1);
    expect(statusLineText(lines)).toBe("");
  });

  it("keeps newest messages on the bottom as more lines arrive", () => {
    logger.show("one", new vec4(1, 1, 1, 1));
    logger.show("two", new vec4(1, 1, 1, 1));

    const filled = scrollLines(lines).filter((line) => line.text !== "");
    expect(filled[filled.length - 2]?.text).toContain("one");
    expect(filled[filled.length - 1]?.text).toContain("two");
  });

  it("evicts the oldest message after the buffer overflows", () => {
    for (let i = 1; i <= DEBUG_CONSOLE_SCROLL_LINE_COUNT; i++) {
      logger.show(`msg-${i}`, new vec4(1, 1, 1, 1));
    }
    logger.show("msg-7", new vec4(1, 1, 1, 1));

    const texts = scrollLines(lines).map((line) => line.text);
    expect(texts.some((text) => text.includes("msg-1"))).toBe(false);
    expect(texts.some((text) => text.includes("msg-2"))).toBe(true);
    expect(newestScroll(lines).text).toContain("msg-7");
  });

  it("applies per-line color", () => {
    logger.show("red", new vec4(1, 0, 0, 1));
    logger.show("green", new vec4(0, 1, 0, 1));

    expect(findScroll(lines, "red")?.textFill.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
    expect(findScroll(lines, "green")?.textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("uses the timestamp captured at log time", () => {
    vi.setSystemTime(new Date(2026, 6, 3, 12, 34, 56));

    logger.show("timed", new vec4(1, 1, 1, 1));

    expect(newestScroll(lines).text).toContain("[12:34:56]");
    expect(newestScroll(lines).text).toContain("timed");
  });

  it("does not remove console lines when the transient entry expires", () => {
    logger.show("persistent", new vec4(1, 1, 1, 1), 0.5);
    logger.tick(1.0);

    expect(newestScroll(lines).text).toContain("persistent");
    expect(logger.snapshot).toBeNull();
  });

  it("clears scroll lines but preserves reserved lines", () => {
    logger.show("remove me", new vec4(1, 1, 1, 1));
    logger.setAgentPrompt({ text: "robot go", valid: true });
    logger.setAgentResponse({ text: "On my way", state: "idle", severity: "ok" });
    logger.clear();

    expect(scrollLines(lines).every((line) => line.text === "")).toBe(true);
    expect(agentPromptLine(lines).text).toContain("robot go");
    expect(agentResponseLine(lines).text).toContain("On my way");
    expect(logger.snapshot).toBeNull();
  });

  it("logConsole appends without updating the transient HUD entry", () => {
    logger.show("transient", new vec4(1, 1, 1, 1), 5);
    logger.logConsole("console-only", new vec4(0, 1, 0, 1));

    expect(logger.snapshot?.text).toBe("transient");
    expect(newestScroll(lines).text).toContain("console-only");
    expect(findScroll(lines, "transient")).toBeDefined();
    expect(statusLineText(lines)).toBe("");
  });

  it("does not write scroll logs to reserved lines", () => {
    logger.show("scroll-only", new vec4(1, 1, 1, 1));

    expect(agentPromptLine(lines).text).toContain(AGENT_PROMPT_PLACEHOLDER);
    expect(agentResponseLine(lines).text).toContain(AGENT_RESPONSE_PLACEHOLDER);
    expect(statusLineText(lines)).toBe("");
  });

  it("pre-fills agent reserved lines on bind", () => {
    expect(agentPromptLine(lines).text).toContain(AGENT_PROMPT_PLACEHOLDER);
    expect(agentResponseLine(lines).text).toContain(AGENT_RESPONSE_PLACEHOLDER);
  });
});

describe("UILogger agent prompt line", () => {
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

  it("renders valid prompts in green", () => {
    logger.setAgentPrompt({ text: "robot move forward", valid: true });

    expect(agentPromptLine(lines).text).toContain("robot move forward");
    expect(agentPromptLine(lines).textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("renders invalid prompts in yellow", () => {
    logger.setAgentPrompt({ text: "hello there", valid: false });

    expect(agentPromptLine(lines).text).toContain("hello there");
    expect(agentPromptLine(lines).textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("restores the prompt placeholder when null", () => {
    logger.setAgentPrompt({ text: "robot", valid: true });
    logger.setAgentPrompt(null);

    expect(agentPromptLine(lines).text).toContain(AGENT_PROMPT_PLACEHOLDER);
  });
});

describe("UILogger agent response line", () => {
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

  it("renders busy responses in yellow", () => {
    logger.setAgentResponse({ text: "Working on it", state: "busy", severity: "ok" });

    expect(agentResponseLine(lines).text).toContain("Working on it");
    expect(agentResponseLine(lines).textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("renders idle ok responses in white", () => {
    logger.setAgentResponse({ text: "Done", state: "idle", severity: "ok" });

    expect(agentResponseLine(lines).text).toContain("Done");
    expect(agentResponseLine(lines).textFill.color).toEqual({ x: 1, y: 1, z: 1, w: 1 });
  });

  it("renders warn idle responses in yellow", () => {
    logger.setAgentResponse({
      text: "Navigation cancelled",
      state: "idle",
      severity: "warn",
    });

    expect(agentResponseLine(lines).text).toContain("Navigation cancelled");
    expect(agentResponseLine(lines).textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("renders error idle responses in red", () => {
    logger.setAgentResponse({
      text: "command not sent (not ready)",
      state: "idle",
      severity: "error",
    });

    expect(agentResponseLine(lines).text).toContain("command not sent (not ready)");
    expect(agentResponseLine(lines).textFill.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
  });

  it("restores the response placeholder when null", () => {
    logger.setAgentResponse({ text: "Done", state: "idle", severity: "ok" });
    logger.setAgentResponse(null);

    expect(agentResponseLine(lines).text).toContain(AGENT_RESPONSE_PLACEHOLDER);
  });
});
