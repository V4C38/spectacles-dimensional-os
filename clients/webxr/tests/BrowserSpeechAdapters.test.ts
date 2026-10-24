import { expect, it, vi } from "vitest";
import { AgentDraftSession } from "@dimos-ar-client/agent/AgentDraftSession";
import { browserRecognition } from "../src/agent/BrowserSpeechAdapters";

it("uses graceful browser stop to collect the last words, and aborts immediately on cancellation", () => {
  let device: Device;
  class Device {
    continuous = false; interimResults = false; lang = "";
    onstart: (() => void) | null = null;
    onresult: ((event: unknown) => void) | null = null;
    onerror = null;
    onend: (() => void) | null = null;
    abort = vi.fn();
    constructor() { device = this; }
    start() { this.onstart?.(); }
    stop() {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "go forward" } }] });
      this.onend?.();
    }
  }
  vi.stubGlobal("window", { SpeechRecognition: Device });
  try {
    const send = vi.fn();
    const speech = new AgentDraftSession({ recognition: browserRecognition(), synthesis: null,
      isSelected: () => true, select() {}, send, estop() {} });
    speech.tick(1, true, null, true); speech.beginRecording();
    expect(speech.snapshot().status).toBe("Listening");
    speech.endRecording();
    expect(speech.snapshot().prompt).toBe("go forward"); expect(speech.snapshot().status).toBe("Ready");
    expect(send).not.toHaveBeenCalled();
    speech.beginRecording(); speech.endRecording(true);
    expect(device!.abort).toHaveBeenCalledOnce(); expect(device!.onresult).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
