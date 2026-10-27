import { expect, it, vi } from "vitest";
import { SpecsCameraStream } from "../../Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraStream";
function stream(running: boolean) {
  return Object.assign(Object.create(SpecsCameraStream.prototype), {
    running, startedAt: 0, metrics: { starts: 0, stops: 0, frames: 0, streamingS: 0 }, generation: 0, pendingResolvers: [], latestFrame: null, provider: null, frameRegistration: null,
    texture: { getWidth: () => 100, getHeight: () => 80 }, loggedFirstFrameSize: true,
  }) as SpecsCameraStream;
}
it("rejects requests on a stopped stream and settles all waiters on stop", async () => {
  await expect(stream(false).requestNextFrame()).rejects.toThrow("not running");
  const active = stream(true), first = active.requestNextFrame(), second = active.requestNextFrame();
  const settled = Promise.all([expect(first).rejects.toThrow("stopped"), expect(second).rejects.toThrow("stopped")]);
  active.stop(); active.stop(); await settled;
});
it.each([undefined, NaN, Infinity, 0, -1])("rejects invalid exposure %s instead of fabricating receipt time", async timestampSeconds => {
  const active = stream(true), frame = active.requestNextFrame(), rejected = expect(frame).rejects.toThrow("exposure timestamp");
  (active as any).onNewFrame({ timestampSeconds }); await rejected;
  expect(active.previewTexture()).toBeNull();
});
it("preserves valid exposure timestamps and ignores late frames after stop", async () => {
  const active = stream(true), promise = active.requestNextFrame();
  (active as any).onNewFrame({ timestampSeconds: 123.5 }); expect((await promise).timestampSeconds).toBe(123.5);
  active.stop(); (active as any).onNewFrame({ timestampSeconds: 124 }); expect(active.previewTexture()).toBeNull();
});
it("ignores a retired provider callback after restarting the stream", async () => {
  const callbacks: Array<(frame: unknown) => void> = [];
  const texture = {
    getWidth: () => 100, getHeight: () => 80,
    control: { onNewFrame: { add: (callback: (frame: unknown) => void) => {
      callbacks.push(callback); return callbacks.length;
    }, remove: vi.fn() } },
  };
  const active = Object.assign(stream(false), {
    deviceCameraValue: {},
    cameraModule: { getSupportedImageResolutions: () => [], requestCamera: () => texture },
  });
  vi.stubGlobal("CameraModule", { CameraId: { Default_Color: 0 }, createCameraRequest: () => ({}) });
  try {
    active.start(); active.stop(); active.start();
    let settled = false;
    const pending = active.requestNextFrame().then(frame => { settled = true; return frame; });
    callbacks[0]({ timestampSeconds: 123 });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(active.previewTexture()).toBeNull();
    callbacks[1]({ timestampSeconds: 124 });
    expect((await pending).timestampSeconds).toBe(124);
    active.stop();
  } finally {
    vi.unstubAllGlobals();
  }
});
