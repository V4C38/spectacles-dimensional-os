// @vitest-environment jsdom
import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { InteractionSoundController } from "../src/presentation/InteractionSoundController";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
function audio() {
  const parameter = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const envelopes: ReturnType<typeof parameter>[] = [];
  const context = { state: "running", currentTime: 0, destination: {}, resume: vi.fn(async () => {}),
    createOscillator: vi.fn(() => ({ type: "", frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null })),
    createGain: vi.fn(() => { const gain = parameter(); envelopes.push(gain); return { gain, connect: vi.fn(), disconnect: vi.fn() }; }) };
  vi.spyOn(THREE.AudioContext, "getContext").mockReturnValue(context as unknown as ReturnType<typeof THREE.AudioContext.getContext>);
  return { context, envelopes };
}
it("keeps cues quiet, skips blocked speech/mute/suspension, and never queues unlock sounds", async () => {
  const { context, envelopes } = audio(), sound = new InteractionSoundController(); sound.setActive(true);
  sound.play("hover", 0); expect(context.createOscillator).not.toHaveBeenCalled();
  await sound.unlock(); sound.play("confirm", 1); expect(context.createOscillator).toHaveBeenCalledOnce();
  expect(envelopes[0].linearRampToValueAtTime.mock.calls[0][0]).toBeLessThanOrEqual(0.025);
  sound.setSuppressed(true); sound.play("activate", 2); sound.setSuppressed(false);
  expect(context.createOscillator).toHaveBeenCalledOnce();
  sound.toggle(); sound.play("select", 3); expect(new InteractionSoundController().enabled).toBe(false);
  sound.toggle(); sound.setActive(false); sound.play("confirm", 4); expect(context.createOscillator).toHaveBeenCalledOnce();
  sound.dispose();
});
it("deduplicates stable hover and requires meaningful movement and time for drag ticks", async () => {
  const { context } = audio(), sound = new InteractionSoundController(); await sound.unlock(); sound.setActive(true);
  const target = {}, position = new THREE.Vector3();
  sound.update(target, false, false, position, 0); sound.update(target, false, false, position, 0.09);
  sound.update(target, false, false, position, 0.3); expect(context.createOscillator).toHaveBeenCalledOnce();
  sound.update(null, false, false, position, 0.31); sound.update(target, false, false, position, 0.32); sound.update(target, false, false, position, 0.41);
  expect(context.createOscillator).toHaveBeenCalledOnce();
  sound.update(null, false, true, position, 1); expect(context.createOscillator).toHaveBeenCalledTimes(2);
  sound.update(null, false, true, position.setX(0.1), 2); expect(context.createOscillator).toHaveBeenCalledTimes(2);
  sound.update(null, false, true, position.setX(0.3), 2.1); expect(context.createOscillator).toHaveBeenCalledTimes(3);
  sound.update(null, false, true, position.setX(0.8), 2.2); expect(context.createOscillator).toHaveBeenCalledTimes(3);
  sound.dispose();
});
