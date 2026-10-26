import { beforeEach, expect, it, vi } from "vitest";
import { setMockTime } from "../setup/lens-globals";
import { SpecsRecognition } from "../../Assets/Scripts/DimOSSpecsClient/agent/AgentSpeechController";

let options: any;
beforeEach(() => {
  setMockTime(0);
  (globalThis as any).AsrModule = {
    AsrMode: { HighAccuracy: 1 }, AsrStatusCode: { Unauthenticated: 2, NoInternet: 3 },
    AsrTranscriptionOptions: { create: () => ({
      onTranscriptionUpdateEvent: { add: (callback: unknown) => { options = { update: callback }; } },
      onTranscriptionErrorEvent: { add: (callback: unknown) => { options.error = callback; } },
    }) },
  };
});
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

it("lets a silence-final arrive after release instead of discarding the transcript", async () => {
  const module = { startTranscribing: vi.fn(), stopTranscribing: vi.fn().mockResolvedValue(undefined) };
  const adapter = new SpecsRecognition(module as unknown as AsrModule);
  const text = vi.fn(), end = vi.fn();
  adapter.start(text, vi.fn(), end, vi.fn()); await flush();
  adapter.finish(); expect(module.stopTranscribing).not.toHaveBeenCalled();
  options.update({ text: "go to the doorway", isFinal: true });
  expect(text).toHaveBeenCalledWith("go to the doorway", true); expect(end).toHaveBeenCalledOnce();
  setMockTime(2); adapter.tick(); expect(end).toHaveBeenCalledOnce();
});

it("serializes a fresh recording after native stop and ignores stale callbacks", async () => {
  let resolveStop = () => {};
  const module = { startTranscribing: vi.fn(), stopTranscribing: vi.fn(() => new Promise<void>(resolve => { resolveStop = resolve; })) };
  const adapter = new SpecsRecognition(module as unknown as AsrModule), oldText = vi.fn(), newText = vi.fn();
  adapter.start(oldText, vi.fn(), vi.fn(), vi.fn()); await flush(); const oldOptions = options;
  adapter.stop(); adapter.start(newText, vi.fn(), vi.fn(), vi.fn()); await flush();
  expect(module.startTranscribing).toHaveBeenCalledOnce();
  oldOptions.update({ text: "stale", isFinal: false }); expect(oldText).not.toHaveBeenCalled();
  resolveStop(); await flush(); expect(module.startTranscribing).toHaveBeenCalledTimes(2);
  options.update({ text: "new draft", isFinal: false }); expect(newText).toHaveBeenCalledWith("new draft", false);
});

it("preserves the last interim draft when a native final never arrives", async () => {
  const module = { startTranscribing: vi.fn(), stopTranscribing: vi.fn().mockResolvedValue(undefined) };
  const adapter = new SpecsRecognition(module as unknown as AsrModule), text = vi.fn(), end = vi.fn();
  adapter.start(text, vi.fn(), end, vi.fn()); await flush();
  options.update({ text: "last interim", isFinal: false }); adapter.finish();
  setMockTime(1.2); adapter.tick(); await flush();
  expect(end).toHaveBeenCalledOnce(); expect(module.stopTranscribing).toHaveBeenCalledOnce();
  options.update({ text: "late", isFinal: true }); expect(text).toHaveBeenCalledTimes(1);
});
