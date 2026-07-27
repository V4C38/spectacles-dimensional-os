import { describe, it, expect } from "vitest";
import {
  AGENT_SESSION_IDLE_TIMEOUT_S,
  closeAgentSpeechSession,
  containsWakeWord,
  createAgentSpeechSessionState,
  deriveAgentPromptEntry,
  isAgentSpeechSessionExpired,
  matchWakeWord,
  matchesStopCommand,
  reduceFinalTranscript,
  StopCommandMatcher,
  touchAgentSpeechSession,
} from "../../Assets/Scripts/App/Agent/AgentSpeechSession";

describe("matchWakeWord", () => {
  it("matches phonetic variants and extracts remainder", () => {
    expect(matchWakeWord("Row bot, go to the kitchen")).toEqual({
      matched: true,
      remainder: "go to the kitchen",
    });
  });

  it("returns wake_only when no remainder", () => {
    expect(matchWakeWord("Robot")).toEqual({
      matched: true,
      remainder: "",
    });
  });

  it("does not match unrelated speech", () => {
    expect(matchWakeWord("hello there")).toEqual({
      matched: false,
      remainder: "",
    });
  });

  it("matches Cyrillic robot", () => {
    expect(matchWakeWord("Робот")).toEqual({
      matched: true,
      remainder: "",
    });
  });

  it("matches Cyrillic with trailing ASR punctuation", () => {
    expect(matchWakeWord("Робот.")).toEqual({
      matched: true,
      remainder: "",
    });
  });

  it("matches stretched Cyrillic and extracts remainder", () => {
    expect(matchWakeWord("Рооообот, go forward")).toEqual({
      matched: true,
      remainder: "go forward",
    });
  });

  it("matches stretched Latin vowels", () => {
    expect(matchWakeWord("Roooobot")).toEqual({
      matched: true,
      remainder: "",
    });
  });
});

describe("reduceFinalTranscript", () => {
  it("opens session on wake word alone", () => {
    const state = createAgentSpeechSessionState();
    const result = reduceFinalTranscript(state, "Robot", 10);

    expect(result.action).toEqual({ kind: "wake_only" });
    expect(result.state.active).toBe(true);
  });

  it("opens session on Cyrillic wake word alone", () => {
    const state = createAgentSpeechSessionState();
    const result = reduceFinalTranscript(state, "Робот", 10);

    expect(result.action).toEqual({ kind: "wake_only" });
    expect(result.state.active).toBe(true);
  });

  it("sends remainder after wake word in one utterance", () => {
    const state = createAgentSpeechSessionState();
    const result = reduceFinalTranscript(state, "Robot go forward", 10);

    expect(result.action).toEqual({ kind: "send", text: "go forward" });
    expect(result.state.active).toBe(true);
  });

  it("sends follow-up commands without wake word when session active", () => {
    const state = touchAgentSpeechSession(createAgentSpeechSessionState(), 5);
    state.active = true;
    const result = reduceFinalTranscript(state, "turn left", 10);

    expect(result.action).toEqual({ kind: "send", text: "turn left" });
  });

  it("ignores speech without wake word when session inactive", () => {
    const state = createAgentSpeechSessionState();
    const result = reduceFinalTranscript(state, "turn left", 10);

    expect(result.action).toEqual({ kind: "ignored" });
    expect(result.state.active).toBe(false);
  });
});

describe("deriveAgentPromptEntry", () => {
  it("marks prompt valid when session is active", () => {
    const state = { active: true, lastActivityTime: 0 };
    expect(deriveAgentPromptEntry(state, "turn left")).toEqual({
      text: "turn left",
      valid: true,
    });
  });

  it("marks prompt valid when wake word appears in partial text", () => {
    const state = createAgentSpeechSessionState();
    expect(deriveAgentPromptEntry(state, "hey row bot")).toEqual({
      text: "hey row bot",
      valid: true,
    });
  });

  it("marks prompt invalid without wake word or session", () => {
    const state = createAgentSpeechSessionState();
    expect(deriveAgentPromptEntry(state, "hello")).toEqual({
      text: "hello",
      valid: false,
    });
  });
});

describe("session expiry", () => {
  it("expires after idle timeout", () => {
    const state = touchAgentSpeechSession(createAgentSpeechSessionState(), 0);
    state.active = true;
    expect(isAgentSpeechSessionExpired(state, AGENT_SESSION_IDLE_TIMEOUT_S)).toBe(true);
  });

  it("does not expire when inactive", () => {
    const state = createAgentSpeechSessionState();
    expect(isAgentSpeechSessionExpired(state, 100)).toBe(false);
  });

  it("closeAgentSpeechSession resets activity", () => {
    const state = { active: true, lastActivityTime: 42 };
    expect(closeAgentSpeechSession(state)).toEqual({
      active: false,
      lastActivityTime: 0,
    });
  });
});

describe("containsWakeWord", () => {
  it("matches rowboat variant", () => {
    expect(containsWakeWord("hey rowboat")).toBe(true);
  });

  it("matches Cyrillic robot", () => {
    expect(containsWakeWord("Робот.")).toBe(true);
  });
});

describe("StopCommandMatcher", () => {
  it("matches stop on word boundary", () => {
    expect(matchesStopCommand("please stop now")).toBe(true);
    expect(matchesStopCommand("stopwatch")).toBe(false);
  });

  it("fires once per utterance until final resets latch", () => {
    const matcher = new StopCommandMatcher();
    expect(matcher.check("stop", false)).toBe(true);
    expect(matcher.check("stop stop", false)).toBe(false);
    expect(matcher.check("stop", true)).toBe(false);
    expect(matcher.check("stop", false)).toBe(true);
  });
});
