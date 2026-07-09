import { findText, COLOR_WHITE } from "./UIKit";

export interface UILogEntry {
  text: string;
  color: vec4;
  expiresAt: number | null;
}

export type UILogListener = (entry: UILogEntry | null) => void;

export const DEBUG_CONSOLE_LINE_NAMES = [
  "ConsoleOutput_Line1",
  "ConsoleOutput_Line2",
  "ConsoleOutput_Line3",
  "ConsoleOutput_Line4",
  "ConsoleOutput_Line5",
  "ConsoleOutput_Line6",
  "ConsoleOutput_Line7",
  "ConsoleOutput_Line8",
  "ConsoleOutput_Line9",
] as const;

export const DEBUG_CONSOLE_LINE_COUNT = DEBUG_CONSOLE_LINE_NAMES.length;

export interface UILogConsoleEntry {
  text: string;
  color: vec4;
  loggedAt: Date;
}

export function formatConsoleTimestamp(loggedAt: Date): string {
  const hours = String(loggedAt.getHours()).padStart(2, "0");
  const minutes = String(loggedAt.getMinutes()).padStart(2, "0");
  const seconds = String(loggedAt.getSeconds()).padStart(2, "0");
  return `[${hours}:${minutes}:${seconds}]`;
}

export function formatConsoleLine(entry: UILogConsoleEntry): string {
  return `${formatConsoleTimestamp(entry.loggedAt)} ${entry.text}`;
}

function cloneColor(color: vec4): vec4 {
  return new vec4(color.x, color.y, color.z, color.w);
}

function cloneEntry(entry: UILogEntry | null): UILogEntry | null {
  if (!entry) {
    return null;
  }
  return {
    text: entry.text,
    color: cloneColor(entry.color),
    expiresAt: entry.expiresAt,
  };
}

/** Shared transient UI log bus with immediate subscriptions and expiry support. */
export class UILogger {
  private readonly _listeners: UILogListener[] = [];
  private _dispatching = false;
  private _pendingEntries: (UILogEntry | null)[] = [];
  private _entry: UILogEntry | null = null;
  private _consoleTexts: (Text | null)[] = [];
  private _consoleBuffer: UILogConsoleEntry[] = [];

  public get snapshot(): UILogEntry | null {
    return cloneEntry(this._entry);
  }

  public bindConsoleOutput(debugLogRoot: SceneObject): void {
    const lines: Text[] = [];
    for (const name of DEBUG_CONSOLE_LINE_NAMES) {
      const text = findText(debugLogRoot, name);
      if (!text) {
        print(`UILogger: missing debug console line ${name}`);
        continue;
      }
      lines.push(text);
    }
    if (lines.length !== DEBUG_CONSOLE_LINE_COUNT) {
      print(
        `UILogger: expected ${DEBUG_CONSOLE_LINE_COUNT} debug console lines, found ${lines.length}`,
      );
      return;
    }
    this.bindConsoleOutputLines(lines);
  }

  public bindConsoleOutputLines(lines: Text[]): void {
    if (lines.length !== DEBUG_CONSOLE_LINE_COUNT) {
      throw new Error(
        `UILogger: expected ${DEBUG_CONSOLE_LINE_COUNT} console lines, got ${lines.length}`,
      );
    }
    this._consoleTexts = lines.slice();
    this._renderConsole();
  }

  public show(text: string, color: vec4, durationSecs: number | null = null): void {
    this.logConsole(text, color);
    const expiresAt =
      durationSecs !== null && durationSecs > 0 ? getTime() + durationSecs : null;
    this._setEntry({
      text,
      color: cloneColor(color),
      expiresAt,
    });
  }

  /** Append a persistent debug-console line without updating the transient HUD entry. */
  public logConsole(text: string, color: vec4): void {
    this._appendConsoleLine(text, color);
  }

  public logCameraStreamStarted(): void {
    this.logConsole("Camera stream ON", COLOR_WHITE);
  }

  public logCameraStreamStopped(): void {
    this.logConsole("Camera stream OFF", COLOR_WHITE);
  }

  public clear(): void {
    const hadConsole = this._consoleBuffer.length > 0;
    this._consoleBuffer = [];
    if (hadConsole) {
      this._renderConsole();
    }
    if (!this._entry) {
      return;
    }
    this._setEntry(null);
  }

  public tick(now: number = getTime()): void {
    if (!this._entry || this._entry.expiresAt === null || now < this._entry.expiresAt) {
      return;
    }
    this._setEntry(null);
  }

  public subscribe(listener: UILogListener): () => void {
    this._listeners.push(listener);
    listener(this.snapshot);
    return () => {
      const index = this._listeners.indexOf(listener);
      if (index >= 0) {
        this._listeners.splice(index, 1);
      }
    };
  }

  private _appendConsoleLine(text: string, color: vec4): void {
    this._consoleBuffer.push({
      text,
      color: cloneColor(color),
      loggedAt: new Date(),
    });
    while (this._consoleBuffer.length > DEBUG_CONSOLE_LINE_COUNT) {
      this._consoleBuffer.shift();
    }
    this._renderConsole();
  }

  private _renderConsole(): void {
    if (this._consoleTexts.length === 0) {
      return;
    }
    const offset = DEBUG_CONSOLE_LINE_COUNT - this._consoleBuffer.length;
    for (let lineIndex = 0; lineIndex < DEBUG_CONSOLE_LINE_COUNT; lineIndex++) {
      const textComponent = this._consoleTexts[lineIndex] ?? null;
      if (!textComponent) {
        continue;
      }
      const bufferIndex = lineIndex - offset;
      const entry =
        bufferIndex >= 0 && bufferIndex < this._consoleBuffer.length
          ? this._consoleBuffer[bufferIndex]
          : null;
      if (entry) {
        textComponent.text = formatConsoleLine(entry);
        textComponent.textFill.color = cloneColor(entry.color);
      } else {
        textComponent.text = "";
      }
    }
  }

  private _setEntry(entry: UILogEntry | null): void {
    const nextEntry = cloneEntry(entry);
    if (this._dispatching) {
      this._pendingEntries.push(nextEntry);
      return;
    }
    this._entry = nextEntry;
    this._dispatching = true;
    try {
      const snapshot = this.snapshot;
      for (const listener of this._listeners.slice()) {
        try {
          listener(snapshot);
        } catch (e) {
          print(`UILogger listener error: ${e}`);
        }
      }
    } finally {
      this._dispatching = false;
    }
    while (this._pendingEntries.length > 0) {
      const queued = this._pendingEntries.splice(0);
      for (const pending of queued) {
        this._setEntry(pending);
      }
    }
  }
}
