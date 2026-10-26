import { afterEach, expect, it, vi } from "vitest";
import { SpecsTextToSpeech } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsTextToSpeech";
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
