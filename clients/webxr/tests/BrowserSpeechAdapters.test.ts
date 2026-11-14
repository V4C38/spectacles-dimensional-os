import { afterEach, expect, it, vi } from "vitest";
import { AgentDraftSession } from "@dimos-ar-client/agent/AgentDraftSession";
import { browserRecognition, recordedRecognition, type BrowserDictation } from "../src/agent/BrowserSpeechAdapters";

afterEach(() => { vi.unstubAllGlobals(); });

function recorderFixture() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  const devices: Device[] = [];
  class Device {
    static isTypeSupported(value: string) { return value === "audio/webm;codecs=opus"; }
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() { devices.push(this); }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(40)], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Device);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("window", {});
  let resolve!: (text: string) => void;
  const cancel = vi.fn();
  let progress: ((status: "preparing" | "transcribing") => void) | undefined;
  const transcribe = vi.fn<BrowserDictation["transcribe"]>((_data, _mime, report) => {
    progress = report;
    return { result: new Promise<string>(done => { resolve = done; }), cancel };
  });
  const port = browserRecognition({ available: () => true, transcribe })!;
  return { port, track, getUserMedia, devices, transcribe, cancel, resolve: (text: string) => resolve(text),
    progress: (status: "preparing" | "transcribing") => progress?.(status) };
}

it("falls back to recorded local dictation, releases the microphone, and waits for explicit Send", async () => {
  const f = recorderFixture(), send = vi.fn();
  const speech = new AgentDraftSession({ recognition: f.port, synthesis: null, isSelected: () => true,
    select() {}, send, estop() {} });
  speech.tick(1, true, null, true); speech.setDraft("Please"); speech.beginRecording();
  await vi.waitFor(() => expect(speech.snapshot().status).toBe("Listening"));
  expect(f.getUserMedia).toHaveBeenCalledWith({ audio: true });
  speech.endRecording();
  await vi.waitFor(() => expect(f.transcribe).toHaveBeenCalledOnce());
  expect(f.track.stop).toHaveBeenCalledOnce();
  f.progress("preparing");
  expect(speech.snapshot().status).toBe("Preparing dictation…");
  speech.tick(120, true, null, true);
  expect(speech.submitTyped("premature command")).toBe(false);
  f.progress("transcribing"); f.resolve("go home");
  await vi.waitFor(() => expect(speech.snapshot().prompt).toBe("Please go home"));
  expect(speech.snapshot().status).toBe("Ready");
  expect(send).not.toHaveBeenCalled();
  expect(speech.submitTyped(speech.snapshot().prompt)).toBe(true);
  expect(send).toHaveBeenCalledWith("Please go home");
});

it("cancels late transcription without replacing the next draft", async () => {
  const f = recorderFixture(), text = vi.fn();
  f.port.start(text, vi.fn(), vi.fn(), vi.fn());
  await vi.waitFor(() => expect(f.devices).toHaveLength(1));
  f.port.finish!();
  await vi.waitFor(() => expect(f.transcribe).toHaveBeenCalledOnce());
  f.port.stop(); f.resolve("obsolete command");
  await Promise.resolve(); await Promise.resolve();
  expect(f.cancel).toHaveBeenCalledOnce(); expect(text).not.toHaveBeenCalled();
});

it("releases a permission response after cancellation and allows another deliberate attempt", async () => {
  const f = recorderFixture();
  let grant!: (stream: Awaited<ReturnType<typeof f.getUserMedia>>) => void;
  f.getUserMedia.mockImplementationOnce(() => new Promise(done => { grant = done; }));
  f.port.start(vi.fn(), vi.fn(), vi.fn(), vi.fn()); f.port.stop();
  grant({ getTracks: () => [f.track] });
  await vi.waitFor(() => expect(f.track.stop).toHaveBeenCalledOnce());
  expect(f.devices).toHaveLength(0);
  f.port.start(vi.fn(), vi.fn(), vi.fn(), vi.fn());
  await vi.waitFor(() => expect(f.devices).toHaveLength(1));
  f.port.stop();
});

it("reports missing media support without falsely claiming permission was denied", () => {
  vi.stubGlobal("MediaRecorder", undefined);
  expect(recordedRecognition({ available: () => true, transcribe: vi.fn() })).toBeNull();
});

it("shows the server's actionable dictation setup reason before requesting a microphone", () => {
  const f = recorderFixture(), error = vi.fn();
  const reason = "Install the speech extra in the selected DimOS environment, then reconnect.";
  const port = recordedRecognition({ available: () => false, availabilityError: () => reason, transcribe: vi.fn() })!;
  port.start(vi.fn(), error, vi.fn(), vi.fn());
  expect(error).toHaveBeenCalledWith(reason);
  expect(f.getUserMedia).not.toHaveBeenCalled();
});

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
