import { describe, expect, it, vi } from "vitest";
import { BrowserAgentSpeech, type RecognitionPort } from "../src/agent/BrowserAgentSpeech";

function fixture(supported = true) {
  let text = (_value: string, _final: boolean) => {};
  let fail = (_reason: string) => {};
  let endSpeech = () => {};
  const recognition: RecognitionPort = {
    start: vi.fn((onText, onError) => { text = onText; fail = onError; }), stop: vi.fn(),
  };
  const synthesis = { speak: vi.fn((_text: string, onEnd: () => void) => { endSpeech = onEnd; }), stop: vi.fn() };
  const send = vi.fn(), estop = vi.fn();
  const speech = new BrowserAgentSpeech({ recognition: supported ? recognition : null, synthesis, send, estop });
  return { speech, recognition, synthesis, send, estop, text: (value: string, final = true) => text(value, final), fail: (reason: string) => fail(reason), endSpeech: () => endSpeech() };
}

describe("BrowserAgentSpeech", () => {
  it("matches wake words, displays partials, sends followups, and expires conversations", () => {
    const f = fixture();
    f.speech.tick(1, true, null, true);
    f.text("go forward"); expect(f.send).not.toHaveBeenCalled();
    f.text("agent go", false); expect(f.speech.snapshot().prompt).toBe("agent go");
    f.text("agent go forward"); expect(f.send).toHaveBeenLastCalledWith("go forward");
    f.text("turn left"); expect(f.send).toHaveBeenLastCalledWith("turn left");
    f.speech.tick(32, true, null, true);
    f.text("turn right"); expect(f.send).toHaveBeenCalledTimes(2);
    f.text("agent"); expect(f.send).toHaveBeenCalledTimes(2);
    f.text("turn right"); expect(f.send).toHaveBeenLastCalledWith("turn right");
  });

  it("latches partial stop matches and retains typed fallback after denial", () => {
    const f = fixture();
    f.speech.tick(1, true, null, true);
    f.text("stop", false); f.text("stop", false); f.text("stop", true);
    expect(f.estop).toHaveBeenCalledOnce();
    f.text("unstoppable"); expect(f.estop).toHaveBeenCalledOnce();
    f.fail("not-allowed");
    f.speech.tick(2, true, null, true);
    expect(f.speech.snapshot().status).toBe("Type a message");
    expect(f.speech.snapshot().error).toContain("not-allowed");
    expect(f.speech.submitTyped("go home")).toBe(true);
    expect(f.send).toHaveBeenLastCalledWith("go home");
  });

  it("supports typed input when recognition is unavailable", () => {
    const f = fixture(false);
    f.speech.tick(1, true, null, true);
    expect(f.speech.snapshot().status).toBe("Type a message");
    expect(f.speech.submitTyped(" ")).toBe(false);
    expect(f.speech.submitTyped("stop")).toBe(true);
    expect(f.estop).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledWith("stop");
    f.speech.stop(); expect(f.speech.submitTyped("go")).toBe(false);
  });

  it("classifies responses, deduplicates TTS, and ignores speech generated during synthesis", () => {
    const f = fixture();
    f.speech.tick(1, true, null, true);
    f.speech.tick(2, true, "No client pose", false);
    expect(f.speech.snapshot().status).toBe("Responding");
    expect(f.speech.snapshot().severity).toBe("error");
    f.text("agent go forward"); expect(f.send).not.toHaveBeenCalled();
    f.speech.tick(3, true, "No client pose", true);
    expect(f.synthesis.speak).toHaveBeenCalledOnce();
    f.endSpeech();
    f.speech.tick(4, true, "No client pose", true);
    expect(f.recognition.start).toHaveBeenCalledTimes(2);
    f.text("agent go forward"); expect(f.send).toHaveBeenCalledWith("go forward");
    f.speech.tick(5, true, "No AR client connected", true);
    expect(f.speech.snapshot().severity).toBe("error");
    f.speech.stop(); f.endSpeech();
    expect(f.speech.snapshot().status).toBe("Off");
  });

  it("stops hardware and discards delayed recognition on disabling", () => {
    const f = fixture();
    f.speech.tick(1, true, null, true);
    f.speech.tick(2, false, null, true);
    f.text("agent go"); expect(f.send).not.toHaveBeenCalled();
    expect(f.recognition.stop).toHaveBeenCalled();
    expect(f.synthesis.stop).toHaveBeenCalled();
    f.speech.tick(3, true, null, false);
    expect(f.speech.snapshot().status).toBe("Thinking");
  });
});
