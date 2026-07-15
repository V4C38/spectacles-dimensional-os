import { CameraCaptureState } from "../../ARBridge/Camera/CameraCaptureSession";
import {
  findText,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
} from "./UIKit";
import type { AgentActivityState } from "../AppState";

export interface UILogEntry {
  text: string;
  color: vec4;
  expiresAt: number | null;
}

export type UILogListener = (entry: UILogEntry | null) => void;

export const DEBUG_CONSOLE_SCROLL_LINE_NAMES = [
  "ConsoleOutput_Line1",
  "ConsoleOutput_Line2",
  "ConsoleOutput_Line3",
  "ConsoleOutput_Line4",
  "ConsoleOutput_Line5",
  "ConsoleOutput_Line6",
] as const;

export const DEBUG_CONSOLE_AGENT_PROMPT_LINE_NAME = "ConsoleOutput_Line7";
export const DEBUG_CONSOLE_AGENT_RESPONSE_LINE_NAME = "ConsoleOutput_Line8";
export const DEBUG_CONSOLE_CAMERA_STATUS_LINE_NAME = "ConsoleOutput_Line9";

export const DEBUG_CONSOLE_SCROLL_LINE_COUNT = DEBUG_CONSOLE_SCROLL_LINE_NAMES.length;

export const DEBUG_CONSOLE_RESERVED_LINE_COUNT = 3;

export const DEBUG_CONSOLE_TOTAL_LINE_COUNT =
  DEBUG_CONSOLE_SCROLL_LINE_COUNT + DEBUG_CONSOLE_RESERVED_LINE_COUNT;

export interface UILogConsoleEntry {
  text: string;
  color: vec4;
  loggedAt: Date;
}

export interface AgentPromptPresentation {
  text: string;
  valid: boolean;
}

export interface AgentResponsePresentation {
  text: string;
  state: AgentActivityState;
  warn?: boolean;
}

export const AGENT_PROMPT_PLACEHOLDER = "User ASR: ...";
export const AGENT_RESPONSE_PLACEHOLDER = "Agent response: ...";

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
  private _agentPromptText: Text | null = null;
  private _agentResponseText: Text | null = null;
  private _cameraStatusText: Text | null = null;
  private _consoleBuffer: UILogConsoleEntry[] = [];
  private _agentPromptEntry: UILogConsoleEntry | null = null;
  private _agentResponseEntry: UILogConsoleEntry | null = null;
  private _cameraStatusEntry: UILogConsoleEntry | null = null;
  private _lastCameraCaptureState: CameraCaptureState | null = null;

  public get snapshot(): UILogEntry | null {
    return cloneEntry(this._entry);
  }

  public bindConsoleOutput(debugLogRoot: SceneObject): void {
    const scrollLines: Text[] = [];
    for (const name of DEBUG_CONSOLE_SCROLL_LINE_NAMES) {
      const text = findText(debugLogRoot, name);
      if (!text) {
        print(`UILogger: missing debug console line ${name}`);
        continue;
      }
      scrollLines.push(text);
    }
    const agentPromptText = findText(debugLogRoot, DEBUG_CONSOLE_AGENT_PROMPT_LINE_NAME);
    if (!agentPromptText) {
      print(
        `UILogger: missing debug console line ${DEBUG_CONSOLE_AGENT_PROMPT_LINE_NAME}`,
      );
    }
    const agentResponseText = findText(debugLogRoot, DEBUG_CONSOLE_AGENT_RESPONSE_LINE_NAME);
    if (!agentResponseText) {
      print(
        `UILogger: missing debug console line ${DEBUG_CONSOLE_AGENT_RESPONSE_LINE_NAME}`,
      );
    }
    const cameraStatusText = findText(debugLogRoot, DEBUG_CONSOLE_CAMERA_STATUS_LINE_NAME);
    if (!cameraStatusText) {
      print(
        `UILogger: missing debug console line ${DEBUG_CONSOLE_CAMERA_STATUS_LINE_NAME}`,
      );
    }
    if (
      scrollLines.length !== DEBUG_CONSOLE_SCROLL_LINE_COUNT ||
      !agentPromptText ||
      !agentResponseText ||
      !cameraStatusText
    ) {
      print(
        `UILogger: expected ${DEBUG_CONSOLE_TOTAL_LINE_COUNT} debug console lines, found ${scrollLines.length + (agentPromptText ? 1 : 0) + (agentResponseText ? 1 : 0) + (cameraStatusText ? 1 : 0)}`,
      );
      return;
    }
    this.bindConsoleOutputLines([
      ...scrollLines,
      agentPromptText,
      agentResponseText,
      cameraStatusText,
    ]);
  }

  public bindConsoleOutputLines(lines: Text[]): void {
    if (lines.length !== DEBUG_CONSOLE_TOTAL_LINE_COUNT) {
      throw new Error(
        `UILogger: expected ${DEBUG_CONSOLE_TOTAL_LINE_COUNT} console lines, got ${lines.length}`,
      );
    }
    this._consoleTexts = lines.slice(0, DEBUG_CONSOLE_SCROLL_LINE_COUNT);
    this._agentPromptText = lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT] ?? null;
    this._agentResponseText = lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 1] ?? null;
    this._cameraStatusText = lines[DEBUG_CONSOLE_SCROLL_LINE_COUNT + 2] ?? null;
    this._resetAgentPromptPlaceholder();
    this._resetAgentResponsePlaceholder();
    this._renderConsole();
    this._renderAgentPromptLine();
    this._renderAgentResponseLine();
    this._renderCameraStatusLine();
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

  public setAgentPrompt(presentation: AgentPromptPresentation | null): void {
    if (!presentation || presentation.text.trim().length === 0) {
      this._resetAgentPromptPlaceholder();
      this._renderAgentPromptLine();
      return;
    }
    const color = presentation.valid ? COLOR_SUCCESS : COLOR_WARN;
    this._agentPromptEntry = {
      text: `User ASR: ${presentation.text}`,
      color: cloneColor(color),
      loggedAt: new Date(),
    };
    this._renderAgentPromptLine();
  }

  public setAgentResponse(presentation: AgentResponsePresentation | null): void {
    if (!presentation || presentation.text.trim().length === 0) {
      this._resetAgentResponsePlaceholder();
      this._renderAgentResponseLine();
      return;
    }
    const color =
      presentation.state === "busy" || presentation.warn === true
        ? COLOR_WARN
        : COLOR_WHITE;
    this._agentResponseEntry = {
      text: `Agent response: ${presentation.text}`,
      color: cloneColor(color),
      loggedAt: new Date(),
    };
    this._renderAgentResponseLine();
  }

  public setCameraCaptureState(state: CameraCaptureState): void {
    if (state === this._lastCameraCaptureState) {
      return;
    }
    this._lastCameraCaptureState = state;
    const text = `Camera capture: ${state}`;
    const color =
      state === "off"
        ? COLOR_WHITE
        : state === "waiting"
          ? COLOR_WARN
          : COLOR_SUCCESS;
    this._cameraStatusEntry = {
      text,
      color: cloneColor(color),
      loggedAt: new Date(),
    };
    this._renderCameraStatusLine();
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
    while (this._consoleBuffer.length > DEBUG_CONSOLE_SCROLL_LINE_COUNT) {
      this._consoleBuffer.shift();
    }
    this._renderConsole();
  }

  private _renderConsole(): void {
    if (this._consoleTexts.length === 0) {
      return;
    }
    const offset = DEBUG_CONSOLE_SCROLL_LINE_COUNT - this._consoleBuffer.length;
    for (let lineIndex = 0; lineIndex < DEBUG_CONSOLE_SCROLL_LINE_COUNT; lineIndex++) {
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

  private _resetAgentPromptPlaceholder(): void {
    this._agentPromptEntry = {
      text: AGENT_PROMPT_PLACEHOLDER,
      color: cloneColor(COLOR_WHITE),
      loggedAt: new Date(),
    };
  }

  private _resetAgentResponsePlaceholder(): void {
    this._agentResponseEntry = {
      text: AGENT_RESPONSE_PLACEHOLDER,
      color: cloneColor(COLOR_WHITE),
      loggedAt: new Date(),
    };
  }

  private _renderAgentPromptLine(): void {
    this._renderReservedLine(this._agentPromptText, this._agentPromptEntry);
  }

  private _renderAgentResponseLine(): void {
    this._renderReservedLine(this._agentResponseText, this._agentResponseEntry);
  }

  private _renderCameraStatusLine(): void {
    this._renderReservedLine(this._cameraStatusText, this._cameraStatusEntry);
  }

  private _renderReservedLine(
    textComponent: Text | null,
    entry: UILogConsoleEntry | null,
  ): void {
    if (!textComponent) {
      return;
    }
    if (entry) {
      textComponent.text = formatConsoleLine(entry);
      textComponent.textFill.color = cloneColor(entry.color);
    } else {
      textComponent.text = "";
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
