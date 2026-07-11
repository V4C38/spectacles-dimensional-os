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

function statusLineText(lines: MockText[]): string {
  return lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT]?.text ?? "";
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

    expect(scrollLineText(lines, 7)).toBe("[12:00:00] first");
    for (let i = 0; i < DEBUG_CONSOLE_SCROLL_LINE_COUNT - 1; i++) {
      expect(scrollLineText(lines, i)).toBe("");
    }
    expect(statusLineText(lines)).toBe("");
  });

  it("keeps newest messages on the bottom as more lines arrive", () => {
    logger.show("one", new vec4(1, 1, 1, 1));
    logger.show("two", new vec4(1, 1, 1, 1));

    expect(scrollLineText(lines, 6)).toContain("one");
    expect(scrollLineText(lines, 7)).toContain("two");
  });

  it("evicts the oldest message after the buffer overflows", () => {
    for (let i = 1; i <= DEBUG_CONSOLE_SCROLL_LINE_COUNT; i++) {
      logger.show(`msg-${i}`, new vec4(1, 1, 1, 1));
    }
    expect(scrollLineText(lines, 0)).toContain("msg-1");

    logger.show("msg-9", new vec4(1, 1, 1, 1));

    expect(scrollLineText(lines, 0)).toContain("msg-2");
    expect(scrollLineText(lines, 7)).toContain("msg-9");
    expect(lines.every((line) => !line.text.endsWith(" msg-1"))).toBe(true);
  });

  it("applies per-line color", () => {
    logger.show("red", new vec4(1, 0, 0, 1));
    logger.show("green", new vec4(0, 1, 0, 1));

    expect(lines[6]?.textFill.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
    expect(lines[7]?.textFill.color).toEqual({ x: 0, y: 1, z: 0, w: 1 });
  });

  it("uses the timestamp captured at log time", () => {
    vi.setSystemTime(new Date(2026, 6, 3, 12, 34, 56));

    logger.show("timed", new vec4(1, 1, 1, 1));

    expect(scrollLineText(lines, 7)).toBe("[12:34:56] timed");
  });

  it("does not remove console lines when the transient entry expires", () => {
    logger.show("persistent", new vec4(1, 1, 1, 1), 0.5);
    logger.tick(1.0);

    expect(scrollLineText(lines, 7)).toContain("persistent");
    expect(logger.snapshot).toBeNull();
  });

  it("clears scroll lines but preserves the camera status line", () => {
    logger.show("remove me", new vec4(1, 1, 1, 1));
    logger.setCameraCaptureState("capturing");
    logger.clear();

    for (let i = 0; i < DEBUG_CONSOLE_SCROLL_LINE_COUNT; i++) {
      expect(scrollLineText(lines, i)).toBe("");
    }
    expect(statusLineText(lines)).toBe("[12:00:00] Camera capture: capturing");
    expect(logger.snapshot).toBeNull();
  });

  it("logConsole appends without updating the transient HUD entry", () => {
    logger.show("transient", new vec4(1, 1, 1, 1), 5);
    logger.logConsole("console-only", new vec4(0, 1, 0, 1));

    expect(logger.snapshot?.text).toBe("transient");
    expect(scrollLineText(lines, 7)).toContain("console-only");
    expect(scrollLineText(lines, 6)).toContain("transient");
    expect(statusLineText(lines)).toBe("");
  });

  it("does not write scroll logs to the camera status line", () => {
    logger.show("scroll-only", new vec4(1, 1, 1, 1));

    expect(statusLineText(lines)).toBe("");
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
