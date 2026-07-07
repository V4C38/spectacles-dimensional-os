import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEBUG_CONSOLE_LINE_COUNT,
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

function createMockLines(count = DEBUG_CONSOLE_LINE_COUNT): MockText[] {
  return Array.from({ length: count }, () => createMockText());
}

function lineText(lines: MockText[], index: number): string {
  return lines[index]?.text ?? "";
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

  it("renders the first message on the bottom line", () => {
    logger.show("first", new vec4(1, 0, 0, 1));

    expect(lineText(lines, 8)).toBe("[12:00:00] first");
    for (let i = 0; i < DEBUG_CONSOLE_LINE_COUNT - 1; i++) {
      expect(lineText(lines, i)).toBe("");
    }
  });

  it("keeps newest messages on the bottom as more lines arrive", () => {
    logger.show("one", new vec4(1, 1, 1, 1));
    logger.show("two", new vec4(1, 1, 1, 1));

    expect(lineText(lines, 7)).toContain("one");
    expect(lineText(lines, 8)).toContain("two");
  });

  it("evicts the oldest message after the buffer overflows", () => {
    for (let i = 1; i <= DEBUG_CONSOLE_LINE_COUNT; i++) {
      logger.show(`msg-${i}`, new vec4(1, 1, 1, 1));
    }
    expect(lineText(lines, 0)).toContain("msg-1");

    logger.show("msg-10", new vec4(1, 1, 1, 1));

    expect(lineText(lines, 0)).toContain("msg-2");
    expect(lineText(lines, 8)).toContain("msg-10");
    expect(lines.every((line) => !line.text.endsWith(" msg-1"))).toBe(true);
  });

  it("applies per-line color", () => {
    logger.show("red", new vec4(1, 0, 0, 1));
    logger.show("green", new vec4(0, 1, 0, 1));

    expect(lines[7]?.textFill.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
    expect(lines[8]?.textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("uses the timestamp captured at log time", () => {
    vi.setSystemTime(new Date(2026, 6, 3, 12, 34, 56));

    logger.show("timed", new vec4(1, 1, 1, 1));

    expect(lineText(lines, 8)).toBe("[12:34:56] timed");
  });

  it("does not remove console lines when the transient entry expires", () => {
    logger.show("persistent", new vec4(1, 1, 1, 1), 0.5);
    logger.tick(1.0);

    expect(lineText(lines, 8)).toContain("persistent");
    expect(logger.snapshot).toBeNull();
  });

  it("clears console lines", () => {
    logger.show("remove me", new vec4(1, 1, 1, 1));
    logger.clear();

    for (const line of lines) {
      expect(line.text).toBe("");
    }
    expect(logger.snapshot).toBeNull();
  });

  it("logConsole appends without updating the transient HUD entry", () => {
    logger.show("transient", new vec4(1, 1, 1, 1), 5);
    logger.logConsole("console-only", new vec4(0, 1, 0, 1));

    expect(logger.snapshot?.text).toBe("transient");
    expect(lineText(lines, 8)).toContain("console-only");
    expect(lineText(lines, 7)).toContain("transient");
  });
});
