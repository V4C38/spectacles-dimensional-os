import { describe, expect, it, vi } from "vitest";
import { lookupPoseSample, selectFrameTimestamp } from "../src/localization/HmdCameraSource";
import { HMD_PROFILES } from "../src/localization/HmdProfiles";
import { cameraFixture } from "./fixtures/camera";

async function readyCapture(f: ReturnType<typeof cameraFixture>) {
  await f.source.waitUntilOpen();
  const pending = f.source.capture();
  await Promise.resolve(); await Promise.resolve();
  return { pending };
}

describe("HmdCameraSource", () => {
  it("bootstraps permission without required constraints, then verifies the physical camera", async () => {
    const f = cameraFixture();
    let granted = false;
    f.media.getUserMedia.mockImplementation(async constraints => {
      if (!granted) {
        // Model browsers that reject required constraints before prompting.
        expect(constraints).toEqual({ video: { facingMode: { ideal: "environment" } }, audio: false });
        granted = true;
      } else {
        expect(constraints.video).toMatchObject({ deviceId: { exact: "physical-left" } });
      }
      return f.stream;
    });
    f.media.enumerateDevices.mockImplementation(async () => {
      expect(granted).toBe(true);
      expect(f.stopped).not.toHaveBeenCalled();
      return [{ kind: "videoinput", label: f.track.label, deviceId: "physical-left" } as MediaDeviceInfo];
    });
    await f.source.requestPermission();
    expect(f.video.play).toHaveBeenCalledOnce();
    expect(f.stopped).toHaveBeenCalledTimes(2);
    expect(f.video.srcObject).toBeNull();
  });

  it("does not accept avatar-only permission as headset camera access", async () => {
    const f = cameraFixture();
    f.media.enumerateDevices.mockResolvedValue([
      { kind: "videoinput", label: "Avatar camera", deviceId: "avatar" } as MediaDeviceInfo,
    ]);
    await expect(f.source.requestPermission()).rejects.toThrow(/No camera matches/);
    expect(f.media.getUserMedia).toHaveBeenCalledOnce();
    expect(f.stopped).toHaveBeenCalledOnce();
    expect(f.video.play).not.toHaveBeenCalled();
  });

  for (const id of ["quest3", "quest3s"] as const) {
    it(`opens the left ${id} camera from the headset's actual device list regardless of order`, async () => {
      const f = cameraFixture(HMD_PROFILES[id]);
      f.track.label = "camera 1, facing back";
      f.media.enumerateDevices.mockResolvedValue([
        { kind: "videoinput", label: "camera 0, facing front", deviceId: "avatar" },
        { kind: "videoinput", label: "camera 2, facing back", deviceId: "physical-right" },
        { kind: "videoinput", label: "camera 1, facing back", deviceId: "physical-left" },
      ] as MediaDeviceInfo[]);
      const { pending } = await readyCapture(f);
      expect(f.media.getUserMedia.mock.calls[1][0].video).toMatchObject({
        deviceId: { exact: "physical-left" },
      });
      f.emit();
      await expect(pending).resolves.toHaveProperty("jpeg");
      f.source.dispose();
    });
  }

  it("prefers captureTime, then presentationTime, and rejects stale or gapped poses", () => {
    expect(selectFrameTimestamp({ captureTime: 12, presentationTime: 99 })).toBe(12);
    expect(selectFrameTimestamp({ presentationTime: 33 })).toBe(33);
    expect(() => selectFrameTimestamp({})).toThrow();
    expect(lookupPoseSample([{ t: 1, position: [0, 0, 0], orientation: [0, 0, 0, 1] }], 1.2)).toBeNull();
    expect(lookupPoseSample([
      { t: 1, position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      { t: 3, position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    ], 2)).toBeNull();
  });

  it("asks permission before enumeration, selects the calibrated device, and freezes at callback", async () => {
    const f = cameraFixture();
    const { pending } = await readyCapture(f);
    expect(f.media.getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(f.media.enumerateDevices.mock.invocationCallOrder[0]);
    expect(f.media.getUserMedia.mock.calls.length).toBe(2);
    f.emit();
    expect(f.jpeg.encode).toHaveBeenCalledOnce();
    f.source.samplePose([99, 0, 0], [0, 0, 0, 1]);
    const observation = await pending;
    expect(observation.ts_capture).toBe(10);
    expect(observation.camera_position).toEqual([0, 0, 0]);
    expect(observation.intrinsics.fx).toBe(600);
    f.source.dispose();
  });

  it("never opens camera hardware with placeholder calibration", async () => {
    const f = cameraFixture({ ...HMD_PROFILES.quest3, intrinsics: { ...HMD_PROFILES.quest3.intrinsics, fx: 0 } });
    await expect(f.source.capture()).rejects.toThrow(/calibration/i);
    expect(f.media.getUserMedia).not.toHaveBeenCalled();
    f.source.dispose();
  });

  it("rejects avatar cameras and mismatched stream profiles", async () => {
    const f = cameraFixture();
    f.track.label = "Avatar camera";
    await expect(f.source.capture()).rejects.toThrow(/identity/);
    expect(f.stopped).toHaveBeenCalled();
    const g = cameraFixture();
    g.track.getSettings = () => ({ width: 640, height: 480, frameRate: 30, facingMode: "environment", deviceId: "physical-left" });
    await expect(g.source.capture()).rejects.toThrow(/does not match/);
    expect(g.stopped).toHaveBeenCalled();
  });

  it("settles pending frame waits on stop and permits another capture", async () => {
    const f = cameraFixture();
    const { pending } = await readyCapture(f);
    f.source.stop();
    await expect(pending).rejects.toThrow(/cancelled/);
    const next = await readyCapture(f);
    f.emit();
    await expect(next.pending).resolves.toHaveProperty("ts_capture", 10);
    f.source.dispose();
  });

  it("releases streams that arrive after cancellation during permission or opening", async () => {
    for (const stage of [1, 2]) {
      const f = cameraFixture();
      let release!: (stream: MediaStream) => void;
      let call = 0;
      f.media.getUserMedia.mockImplementation(() => ++call === stage ? new Promise(resolve => { release = resolve; }) : Promise.resolve(f.stream));
      const pending = f.source.capture();
      for (let i = 0; i < 12 && !release; i++) await Promise.resolve();
      expect(release).toBeDefined();
      f.source.stop();
      await expect(pending).rejects.toThrow(/cancelled/);
      release(f.stream);
      await Promise.resolve(); await Promise.resolve();
      expect(f.stopped).toHaveBeenCalled();
      expect(f.frames.start).not.toHaveBeenCalled();
    }
  });

  it("waits for video playback and releases resources when stopped during playback", async () => {
    const f = cameraFixture();
    let finish!: () => void;
    f.video.play.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    f.source.start();
    for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
    const pending = f.source.capture();
    f.source.stop();
    finish();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(f.stopped).toHaveBeenCalled();
    expect(f.frames.start).not.toHaveBeenCalled();
    expect(f.video.srcObject).toBeNull();
  });

  it("surfaces permission denial without opening a stream", async () => {
    const f = cameraFixture();
    f.media.getUserMedia.mockRejectedValue(new Error("Permission denied"));
    await expect(f.source.capture()).rejects.toThrow("Permission denied");
    expect(f.frames.start).not.toHaveBeenCalled();
    expect(f.media.enumerateDevices).not.toHaveBeenCalled();
  });

  it("discards an encoding result after stop and bounds frame waits", async () => {
    const f = cameraFixture();
    let finish!: (value: { jpeg: Uint8Array<ArrayBuffer>; width: number; height: number }) => void;
    f.jpeg.encode.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { pending } = await readyCapture(f);
    f.emit();
    f.source.stop();
    finish({ jpeg: new Uint8Array([1]), width: 1280, height: 960 });
    await expect(pending).rejects.toThrow(/cancelled/);
    const g = cameraFixture();
    vi.useFakeTimers();
    try {
      const capture = await readyCapture(g);
      const rejected = expect(capture.pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(3001);
      await rejected;
    } finally { g.source.stop(); vi.useRealTimers(); }
  });
});

for (const id of ["quest3", "quest3s"] as const) {
  it(`captures a localization observation with the ${id} profile`, async () => {
    const profile = HMD_PROFILES[id];
    const f = cameraFixture(profile);
    expect(f.source.availabilityError()).toBeNull();
    const { pending } = await readyCapture(f);
    f.emit();
    const observation = await pending;
    expect(observation.intrinsics).toEqual(profile.intrinsics);
    expect(observation.camera_position[0]).toBeGreaterThan(0.05);
    expect(observation.camera_orientation.every(Number.isFinite)).toBe(true);
    f.source.dispose();
  });
}

it("binds a browser 720p frame to cropped intrinsics", async () => {
  const f = cameraFixture(HMD_PROFILES.quest3);
  f.track.getSettings = () => ({ width: 1280, height: 720, frameRate: 30, facingMode: "environment", deviceId: "physical-left" });
  f.jpeg.encode.mockResolvedValue({ jpeg: new Uint8Array([0xff, 0xd8]), width: 1280, height: 720 });
  const { pending } = await readyCapture(f);
  f.emit();
  const observation = await pending;
  expect(observation.intrinsics.height).toBe(720);
  expect(observation.intrinsics.cy).toBeCloseTo(361.2428589);
  f.source.dispose();
});

it("offers a read-only preview from the validated capture stream and retires it on stop", async () => {
  const f = cameraFixture();
  expect(f.source.previewFrame()).toBeNull();
  await f.source.waitUntilOpen();
  expect(f.source.previewFrame()).toEqual({ video: f.video, width: 1280, height: 960 });
  const opens = f.media.getUserMedia.mock.calls.length;
  f.source.previewFrame(); f.source.previewFrame();
  expect(f.media.getUserMedia).toHaveBeenCalledTimes(opens);
  expect(f.jpeg.encode).not.toHaveBeenCalled();
  f.source.stop(); expect(f.source.previewFrame()).toBeNull();
});

it("bounds stale-frame retries in the WebXR host without changing Specs capture policy", async () => {
  let now = 10;
  const f = cameraFixture(HMD_PROFILES.quest3, { now: () => now });
  for (let attempt = 0; attempt < 3; attempt++) {
    f.source.samplePose([0, 0, 0], [0, 0, 0, 1], now);
    let complete!: (value: Awaited<ReturnType<typeof f.jpeg.encode>>) => void;
    f.jpeg.encode.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const { pending } = await readyCapture(f);
    const rejected = expect(pending).rejects.toMatchObject({ retryable: attempt < 2 });
    f.emit(); now += 4;
    complete({ jpeg: new Uint8Array([255, 216]), width: 1280, height: 960 });
    await rejected;
  }
  f.source.samplePose([0, 0, 0], [0, 0, 0, 1], now);
  const fresh = await readyCapture(f); f.emit();
  await expect(fresh.pending).resolves.toHaveProperty("ts_capture", now);
});
