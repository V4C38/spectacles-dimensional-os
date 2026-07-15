// ================================================================
/** Pure wake-word, session, e-stop, and prompt-derivation logic for agent speech. */
// ================================================================

export const WAKE_WORD_VARIANTS = [
  "robot",
  "robots",
  "row bot",
  "rowbot",
  "robo",
  "robert",
  "roboto",
  "robat",
  "robit",
  "rowboat",
] as const;

export const AGENT_SESSION_IDLE_TIMEOUT_S = 15.0;

export type FinalTranscriptAction =
  | { kind: "send"; text: string }
  | { kind: "wake_only" }
  | { kind: "ignored" };

export interface AgentSpeechSessionState {
  active: boolean;
  lastActivityTime: number;
}

export interface AgentPromptEntry {
  text: string;
  valid: boolean;
}

export function createAgentSpeechSessionState(): AgentSpeechSessionState {
  return {
    active: false,
    lastActivityTime: 0,
  };
}

export function closeAgentSpeechSession(
  state: AgentSpeechSessionState,
): AgentSpeechSessionState {
  return {
    active: false,
    lastActivityTime: 0,
  };
}

export function touchAgentSpeechSession(
  state: AgentSpeechSessionState,
  now: number,
): AgentSpeechSessionState {
  return {
    ...state,
    lastActivityTime: now,
  };
}

export function isAgentSpeechSessionExpired(
  state: AgentSpeechSessionState,
  now: number,
  timeoutS: number = AGENT_SESSION_IDLE_TIMEOUT_S,
): boolean {
  return state.active && now - state.lastActivityTime >= timeoutS;
}

export function containsWakeWord(text: string): boolean {
  const lowerText = text.toLowerCase();
  return WAKE_WORD_VARIANTS.some((variant) => lowerText.includes(variant));
}

export function matchWakeWord(text: string): { matched: boolean; remainder: string } {
  const lowerText = text.toLowerCase();
  let wakeIndex = -1;
  let matchedLength = 0;
  for (const variant of WAKE_WORD_VARIANTS) {
    const idx = lowerText.indexOf(variant);
    if (idx >= 0) {
      wakeIndex = idx;
      matchedLength = variant.length;
      break;
    }
  }
  if (wakeIndex < 0) {
    return { matched: false, remainder: "" };
  }
  const afterWake = text.substring(wakeIndex + matchedLength).trim();
  const remainder = afterWake.replace(/^[,.\s!?]+/, "").trim();
  return { matched: true, remainder };
}

export function reduceFinalTranscript(
  state: AgentSpeechSessionState,
  text: string,
  now: number,
): { state: AgentSpeechSessionState; action: FinalTranscriptAction } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { state, action: { kind: "ignored" } };
  }

  if (state.active) {
    return {
      state: touchAgentSpeechSession(state, now),
      action: { kind: "send", text: trimmed },
    };
  }

  const wakeMatch = matchWakeWord(trimmed);
  if (!wakeMatch.matched) {
    return { state, action: { kind: "ignored" } };
  }

  const nextState: AgentSpeechSessionState = {
    active: true,
    lastActivityTime: now,
  };
  if (wakeMatch.remainder.length > 0) {
    return {
      state: nextState,
      action: { kind: "send", text: wakeMatch.remainder },
    };
  }
  return {
    state: nextState,
    action: { kind: "wake_only" },
  };
}

export function deriveAgentPromptEntry(
  state: AgentSpeechSessionState,
  text: string,
): AgentPromptEntry | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const valid = state.active || containsWakeWord(trimmed);
  return { text: trimmed, valid };
}

export function matchesStopCommand(text: string): boolean {
  return /\bstop\b/i.test(text);
}

/** Latches after a partial match until the next final transcript resets it. */
export class StopCommandMatcher {
  private _latched = false;

  public check(text: string, isFinal: boolean): boolean {
    if (isFinal) {
      if (this._latched) {
        this._latched = false;
        return false;
      }
      return matchesStopCommand(text);
    }
    if (this._latched) {
      return false;
    }
    if (matchesStopCommand(text)) {
      this._latched = true;
      return true;
    }
    return false;
  }

  public reset(): void {
    this._latched = false;
  }
}
