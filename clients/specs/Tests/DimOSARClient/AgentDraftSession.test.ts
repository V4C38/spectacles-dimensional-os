import { describe, expect, it, vi } from "vitest";
import { AgentDraftSession, type RecognitionPort } from "../../Assets/Scripts/DimOSARClient/agent/AgentDraftSession";

function fixture(supported = true, graceful = false) {
  let text = (_value: string, _final: boolean) => {};
  let fail = (_reason: string) => {};
  let started = () => {};
  let ended = () => {};
  let endSpeech = () => {};
  let selected = false;
  const select = vi.fn(() => { selected = true; });
  const recognition: RecognitionPort = {
    start: vi.fn((onText, onError, onEnd, onStarted) => { text = onText; fail = onError; ended = onEnd; started = onStarted; }), stop: vi.fn(),
  };
  if (graceful) recognition.finish = vi.fn();
  const synthesis = { speak: vi.fn((_text: string, onEnd: () => void) => { endSpeech = onEnd; }), stop: vi.fn() };
  const send = vi.fn(), estop = vi.fn();
  const speech = new AgentDraftSession({ recognition: supported ? recognition : null, synthesis, send, estop,
    isSelected: () => selected, select });
  speech.tick(1, true, null, true);
  return { speech, recognition, synthesis, send, estop, select,
    setSelected: (value: boolean) => { selected = value; },
    text: (value: string, final = true) => text(value, final), started: () => started(), ended: () => ended(),
    fail: (reason: string) => fail(reason), endSpeech: () => endSpeech() };
}

describe("hold-to-record agent drafts", () => {
  it("starts only on a hold and labels Listening only after the microphone starts", () => {
    const f = fixture();
    expect(f.recognition.start).not.toHaveBeenCalled(); expect(f.speech.snapshot().status).toBe("Ready");
    expect(f.speech.beginRecording()).toBe(true); expect(f.select).toHaveBeenCalledOnce();
    expect(f.speech.snapshot().status).toBe("Starting microphone…");
    f.started(); expect(f.speech.snapshot().status).toBe("Listening");
    f.speech.endRecording(); expect(f.recognition.stop).toHaveBeenCalled();
    expect(f.speech.snapshot().status).toBe("Ready");
    f.speech.tick(100, true, null, true); expect(f.recognition.start).toHaveBeenCalledOnce();
  });

  it("replaces interim results, appends final segments, and preserves the last interim on release", () => {
    const f = fixture(); f.speech.beginRecording(); f.started();
    f.text("go", false); f.text("go forward", false); expect(f.speech.snapshot().prompt).toBe("go forward");
    f.text("go forward"); f.text("then turn", false); f.text("then turn left", false);
    f.speech.endRecording(); expect(f.speech.snapshot().prompt).toBe("go forward then turn left");
    expect(f.send).not.toHaveBeenCalled();
    f.text("late final"); expect(f.speech.snapshot().prompt).toBe("go forward then turn left");
    f.speech.beginRecording(); f.started(); f.text("and stop"); f.speech.endRecording();
    expect(f.speech.snapshot().prompt).toBe("go forward then turn left and stop");
    expect(f.estop).not.toHaveBeenCalled();
  });

  it("sends only on explicit confirmation, rejects sending during capture and clears a successfully sent draft", () => {
    const f = fixture(); f.speech.beginRecording(); f.started(); f.text("agent go home");
    expect(f.speech.submitTyped(f.speech.snapshot().prompt)).toBe(false);
    f.speech.endRecording(); expect(f.send).not.toHaveBeenCalled();
    expect(f.speech.submitTyped(f.speech.snapshot().prompt)).toBe(true);
    expect(f.send).toHaveBeenCalledWith("agent go home"); // dictation does not strip wake words
    expect(f.speech.snapshot().prompt).toBe("");
    expect(f.speech.submitTyped("")).toBe(false);
  });

  it("keeps typed fallback and a draft after permission failure or send failure", () => {
    const f = fixture(); f.speech.setDraft("go home"); f.speech.beginRecording(); f.fail("not-allowed");
    f.speech.tick(2, true, null, true); expect(f.speech.snapshot().status).toBe("Type a message");
    expect(f.speech.snapshot().error).toContain("not-allowed");
    f.send.mockImplementationOnce(() => { throw new Error("connection lost"); });
    expect(f.speech.submitTyped("go home")).toBe(false); expect(f.speech.snapshot().prompt).toBe("go home");
    expect(f.speech.submitTyped("go home")).toBe(true);
    const unavailable = fixture(false); unavailable.setSelected(true);
    expect(unavailable.speech.beginRecording()).toBe(false);
    expect(unavailable.speech.submitTyped("typed input")).toBe(true);
  });

  it("restarts recognition only while held and ignores delayed callbacks after mode or input loss", () => {
    const f = fixture(); f.speech.beginRecording(); f.started(); f.text("go", false); f.ended();
    expect(f.speech.snapshot().status).not.toBe("Listening");
    f.speech.tick(2, true, null, true); expect(f.recognition.start).toHaveBeenCalledTimes(2);
    f.speech.tick(3, false, null, true); f.started(); f.text("late command");
    expect(f.speech.snapshot().status).toBe("Off"); expect(f.speech.snapshot().prompt).toBe("go");
    expect(f.send).not.toHaveBeenCalled();
  });

  it("keeps responses separate from drafts and interrupts synthesis when capture begins", () => {
    const f = fixture(); f.speech.setDraft("draft"); f.speech.tick(2, true, "No client pose", false);
    expect(f.speech.snapshot().response).toBe("No client pose"); expect(f.speech.snapshot().severity).toBe("error");
    expect(f.speech.snapshot().prompt).toBe("draft");
    f.speech.tick(3, true, "No client pose", true); expect(f.synthesis.speak).toHaveBeenCalledOnce();
    f.speech.beginRecording(); f.started(); expect(f.synthesis.stop).toHaveBeenCalled();
    f.speech.endRecording(); f.endSpeech(); expect(f.speech.snapshot().status).not.toBe("Listening");
  });
});


it("finalizes captured audio after release without showing Listening or enabling Send prematurely", () => {
  const f = fixture(true, true); f.speech.beginRecording(); f.started();
  f.text("go for", false); f.speech.endRecording();
  expect(f.recognition.finish).toHaveBeenCalledOnce();
  expect(f.speech.snapshot().status).toBe("Transcribing…");
  expect(f.speech.submitTyped(f.speech.snapshot().prompt)).toBe(false);
  f.text("go forward", true); f.ended();
  expect(f.speech.snapshot().prompt).toBe("go forward");
  expect(f.speech.snapshot().status).toBe("Ready");
  expect(f.send).not.toHaveBeenCalled();
  expect(f.speech.submitTyped(f.speech.snapshot().prompt)).toBe(true);
  f.speech.beginRecording(); f.started(); f.text("turn", false); f.speech.endRecording();
  f.speech.tick(100, true, null, true);
  expect(f.speech.snapshot().status).toBe("Ready");
  f.text("late", true); expect(f.speech.snapshot().prompt).toBe("turn");
});



it("permits a new hold after temporary speech failures and rejects stale callbacks", () => {
  const f = fixture(); f.speech.beginRecording(); f.started(); f.text("draft", false);
  f.fail("no-speech");
  expect(f.speech.snapshot().recognitionAvailable).toBe(true);
  expect(f.speech.snapshot().prompt).toBe("draft");
  expect(f.speech.beginRecording()).toBe(true);
  f.started(); f.fail("network"); expect(f.speech.beginRecording()).toBe(true);
  f.speech.reset(); expect(f.speech.snapshot().prompt).toBe("");
  f.text("late"); expect(f.speech.snapshot().prompt).toBe("");
});

it("appends a new recording to the existing draft without sending it", () => {
  const f = fixture();
  f.speech.setDraft("Go forward.");
  f.speech.beginRecording(); f.started(); f.text("Then turn left."); f.speech.endRecording();
  expect(f.speech.snapshot().prompt).toBe("Go forward. Then turn left.");
  f.speech.beginRecording(); f.started(); f.text("And stop."); f.speech.endRecording();
  expect(f.speech.snapshot().prompt).toBe("Go forward. Then turn left. And stop.");
  expect(f.send).not.toHaveBeenCalled();
});
