import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEBUG_CONSOLE_SCROLL_LINE_COUNT,
  DEBUG_CONSOLE_TOTAL_LINE_COUNT,
  formatConsoleLine,
  formatConsoleTimestamp,
  UILogConsoleEntry,
  UILogger,
} from "../../Assets/Scripts/App/UI/UILogger";

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

function scrollLineText(lines: MockText[], index: number): string {
  return lines[index]?.text ?? "";
}

function agentPromptLineText(lines: MockText[]): string {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.text ?? "";
}

function agentResponseLineText(lines: MockText[]): string {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1]?.text ?? "";
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
      text: "Bridge connected",
      color: new vec4(1, 1, 1, 1),
      loggedAt: new Date(2026, 6, 3, 9, 30, 0),
    };
    expect(formatConsoleLine(entry)).toBe("[09:30:00] Bridge connected");
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

    expect(scrollLineText(lines, 5)).toBe("[12:00:00] first");
    for (let i = 0; i < DEBUG_CONSOLE_SCROLL_LINE_COUNT - 1; i++) {
      expect(scrollLineText(lines, i)).toBe("");
    }
    expect(statusLineText(lines)).toBe("");
  });

  it("keeps newest messages on the bottom as more lines arrive", () => {
    logger.show("one", new vec4(1, 1, 1, 1));
    logger.show("two", new vec4(1, 1, 1, 1));

    expect(scrollLineText(lines, 4)).toContain("one");
    expect(scrollLineText(lines, 5)).toContain("two");
  });

  it("evicts the oldest message after the buffer overflows", () => {
    for (let i = 1; i <= DEBUG_CONSOLE_SCROLL_LINE_COUNT; i++) {
      logger.show(`msg-${i}`, new vec4(1, 1, 1, 1));
    }
    expect(scrollLineText(lines, 0)).toContain("msg-1");

    logger.show("msg-7", new vec4(1, 1, 1, 1));

    expect(scrollLineText(lines, 0)).toContain("msg-2");
    expect(scrollLineText(lines, 5)).toContain("msg-7");
    expect(lines.every((line) => !line.text.endsWith(" msg-1"))).toBe(true);
  });

  it("applies per-line color", () => {
    logger.show("red", new vec4(1, 0, 0, 1));
    logger.show("green", new vec4(0, 1, 0, 1));

    expect(lines[4]?.textFill.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
    expect(lines[5]?.textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("uses the timestamp captured at log time", () => {
    vi.setSystemTime(new Date(2026, 6, 3, 12, 34, 56));

    logger.show("timed", new vec4(1, 1, 1, 1));

    expect(scrollLineText(lines, 5)).toBe("[12:34:56] timed");
  });

  it("does not remove console lines when the transient entry expires", () => {
    logger.show("persistent", new vec4(1, 1, 1, 1), 0.5);
    logger.tick(1.0);

    expect(scrollLineText(lines, 5)).toContain("persistent");
    expect(logger.snapshot).toBeNull();
  });

  it("clears scroll lines but preserves reserved lines", () => {
    logger.show("remove me", new vec4(1, 1, 1, 1));
    logger.setCameraCaptureState("capturing");
    logger.setAgentPrompt({ text: "robot go", valid: true });
    logger.setAgentResponse({ text: "On my way", state: "idle", severity: "ok" });
    logger.clear();

    for (let i = 0; i < DEBUG_CONSOLE_SCROLL_LINE_COUNT; i++) {
      expect(scrollLineText(lines, i)).toBe("");
    }
    expect(agentPromptLineText(lines)).toContain("User ASR: robot go");
    expect(agentResponseLineText(lines)).toContain("Agent response: On my way");
    expect(statusLineText(lines)).toBe("[12:00:00] Camera capture: capturing");
    expect(logger.snapshot).toBeNull();
  });

  it("logConsole appends without updating the transient HUD entry", () => {
    logger.show("transient", new vec4(1, 1, 1, 1), 5);
    logger.logConsole("console-only", new vec4(0, 1, 0, 1));

    expect(logger.snapshot?.text).toBe("transient");
    expect(scrollLineText(lines, 5)).toContain("console-only");
    expect(scrollLineText(lines, 4)).toContain("transient");
    expect(statusLineText(lines)).toBe("");
  });

  it("does not write scroll logs to reserved lines", () => {
    logger.show("scroll-only", new vec4(1, 1, 1, 1));

    expect(agentPromptLineText(lines)).toContain("User ASR: ...");
    expect(agentResponseLineText(lines)).toContain("Agent response: ...");
    expect(statusLineText(lines)).toBe("");
  });

  it("pre-fills agent reserved lines on bind", () => {
    expect(agentPromptLineText(lines)).toBe("[12:00:00] User ASR: ...");
    expect(agentResponseLineText(lines)).toBe("[12:00:00] Agent response: ...");
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

    expect(agentPromptLineText(lines)).toBe("[12:00:00] User ASR: robot move forward");
    expect(lines[6]?.textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("renders invalid prompts in yellow", () => {
    logger.setAgentPrompt({ text: "hello there", valid: false });

    expect(agentPromptLineText(lines)).toBe("[12:00:00] User ASR: hello there");
    expect(lines[6]?.textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("restores the prompt placeholder when null", () => {
    logger.setAgentPrompt({ text: "robot", valid: true });
    logger.setAgentPrompt(null);

    expect(agentPromptLineText(lines)).toBe("[12:00:00] User ASR: ...");
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

    expect(agentResponseLineText(lines)).toBe("[12:00:00] Agent response: Working on it");
    expect(lines[7]?.textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("renders idle ok responses in white", () => {
    logger.setAgentResponse({ text: "Done", state: "idle", severity: "ok" });

    expect(agentResponseLineText(lines)).toBe("[12:00:00] Agent response: Done");
    expect(lines[7]?.textFill.color).toEqual({ x: 1, y: 1, z: 1, w: 1 });
  });

  it("renders warn idle responses in yellow", () => {
    logger.setAgentResponse({
      text: "Navigation cancelled",
      state: "idle",
      severity: "warn",
    });

    expect(agentResponseLineText(lines)).toBe(
      "[12:00:00] Agent response: Navigation cancelled",
    );
    expect(lines[7]?.textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("renders error idle responses in red", () => {
    logger.setAgentResponse({
      text: "command not sent (bridge not ready)",
      state: "idle",
      severity: "error",
    });

    expect(agentResponseLineText(lines)).toBe(
      "[12:00:00] Agent response: command not sent (bridge not ready)",
    );
    expect(lines[7]?.textFill.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
  });

  it("restores the response placeholder when null", () => {
    logger.setAgentResponse({ text: "Done", state: "idle", severity: "ok" });
    logger.setAgentResponse(null);

    expect(agentResponseLineText(lines)).toBe("[12:00:00] Agent response: ...");
  });
});

describe("UILogger camera status line", () => {
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

  it("renders capturing in green on the dedicated status line", () => {
    logger.setCameraCaptureState("capturing");

    expect(statusLineText(lines)).toBe("[12:00:00] Camera capture: capturing");
    expect(lines[8]?.textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("renders waiting in yellow on the dedicated status line", () => {
    logger.setCameraCaptureState("waiting");

    expect(statusLineText(lines)).toBe("[12:00:00] Camera capture: waiting");
    expect(lines[8]?.textFill.color).toEqual({ x: 1, y: 0.85, z: 0, w: 1 });
  });

  it("renders off in white on the dedicated status line", () => {
    logger.setCameraCaptureState("off");

    expect(statusLineText(lines)).toBe("[12:00:00] Camera capture: off");
    expect(lines[8]?.textFill.color).toEqual({ x: 1, y: 1, z: 1, w: 1 });
  });

  it("does not refresh the timestamp when status is unchanged", () => {
    logger.setCameraCaptureState("capturing");
    vi.setSystemTime(new Date(2026, 6, 3, 12, 5, 0));

    logger.setCameraCaptureState("capturing");

    expect(statusLineText(lines)).toBe("[12:00:00] Camera capture: capturing");
  });
});
