import { afterEach, expect, it, vi } from "vitest";
import { SpecsTextToSpeech } from "../../Assets/Scripts/DimOSSpecsClient/agent/SpecsSpeechAdapters";
afterEach(() => vi.unstubAllGlobals());
it.each(["enabled", "isEnabledInHierarchy"] as const)("can cancel pending speech with %s disabled", (property) => {
  vi.stubGlobal("TextToSpeech", { Options: { create: () => ({}) } });
  let complete = (_track: unknown) => {};
  const audio = { enabled: true, isEnabledInHierarchy: true, play: vi.fn(), stop: vi.fn(), isPlaying: vi.fn(() => false) };
  const tts = new SpecsTextToSpeech({ audio, module: { synthesize: (_text: string, _options: unknown, callback: typeof complete) => { complete = callback; } } } as never);
  const ended = vi.fn();
  tts.speak("Hello", ended);
  audio[property] = false;
  expect(() => tts.stop()).not.toThrow();
  expect(audio.stop).not.toHaveBeenCalled();
  expect(tts.isPlaying).toBe(false);
  complete({});
  tts.tick();
  expect(audio.play).not.toHaveBeenCalled();
  expect(ended).not.toHaveBeenCalled();
  audio[property] = true;
  audio.isPlaying.mockReturnValue(true);
  tts.stop();
  expect(audio.stop).toHaveBeenCalledWith(false);
});

it("does not call native stop on an enabled idle component without a player", () => {
  const audio = { enabled: true, isEnabledInHierarchy: true, isPlaying: () => false, stop: vi.fn(() => { throw new Error("Audio player is not enabled"); }) };
  const tts = new SpecsTextToSpeech({ audio, module: {} } as never);
  expect(() => tts.stop()).not.toThrow();
  expect(audio.stop).not.toHaveBeenCalled();
});

it("recovers from synchronous synthesis errors and accepts the next request", () => {
  vi.stubGlobal("TextToSpeech", { Options: { create: () => ({}) } });
  let fail = true;
  const play = vi.fn(), ended = vi.fn();
  const tts = new SpecsTextToSpeech({ audio: { enabled: true, play, isPlaying: () => false },
    module: { synthesize: (_text: string, _options: unknown, complete: (track: unknown) => void) => {
      if (fail) throw new Error("native synthesis failed"); complete({});
    } } } as never);
  expect(() => tts.speak("first", ended)).toThrow("native synthesis failed");
  expect(tts.isPlaying).toBe(false); expect(ended).toHaveBeenCalledOnce();
  fail = false; tts.speak("second", ended); tts.tick();
  expect(play).toHaveBeenCalledOnce(); expect(ended).toHaveBeenCalledTimes(2);
});

it("settles callback failures once and ignores their late successful callback", () => {
  vi.stubGlobal("TextToSpeech", { Options: { create: () => ({}) } });
  let complete!: (track: unknown) => void, reject!: (code: number, message: string) => void;
  const play = vi.fn(), ended = vi.fn();
  const tts = new SpecsTextToSpeech({ audio: { enabled: true, play, isPlaying: () => false },
    module: { synthesize: (_text: string, _options: unknown, good: typeof complete, bad: typeof reject) => { complete = good; reject = bad; } } } as never);
  tts.speak("first", ended); reject(1, "unavailable"); reject(1, "duplicate"); complete({}); tts.tick();
  expect(tts.isPlaying).toBe(false); expect(ended).toHaveBeenCalledOnce(); expect(play).not.toHaveBeenCalled();
});
