import { describe, expect, it } from "vitest";
import {
  HmdCameraSource,
  lookupPoseSample,
  selectFrameTimestamp,
  type VideoFrameMetadata,
} from "../src/camera/HmdCameraSource";
import { acceptProfile } from "../src/camera/calibrationRunner";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";
import type { HmdCalibrationProfile } from "../src/camera/HmdCalibration";

function acceptedProfile(): HmdCalibrationProfile {
  return acceptProfile(
    {
      ...HMD_PROFILES.quest3,
      accepted: false,
      measuredAt: null,
      intrinsics: { ...HMD_PROFILES.quest3.intrinsics, fx: 600, fy: 600 },
    },
    {
      accepted: true,
      meanReprojectionPx: 0.2,
      maxReprojectionPx: 0.4,
      maxOriginErrorM: 0.01,
      observationCount: 4,
      reasons: [],
    },
    "2026-09-14T00:00:00Z",
  );
}

describe("HmdCameraSource timestamps", () => {
  it("prefers captureTime, then presentationTime, otherwise rejects", () => {
    expect(selectFrameTimestamp({ captureTime: 12, presentationTime: 99 })).toBe(12);
    expect(selectFrameTimestamp({ presentationTime: 33 })).toBe(33);
    expect(() => selectFrameTimestamp({})).toThrow("frame timestamp is missing");
  });

  it("rejects stale pose samples", () => {
    expect(lookupPoseSample([{ t: 1, position: [0, 0, 0], orientation: [0, 0, 0, 1] }], 1.2)).toBeNull();
    expect(lookupPoseSample([{ t: 1, position: [0, 0, 0], orientation: [0, 0, 0, 1] }], 1.05)?.t).toBe(1);
  });
});

describe("HmdCameraSource capture", () => {
  it("emits a localization observation from injected camera ports", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    let emitFrame = (_video: HTMLVideoElement, _metadata: VideoFrameMetadata): void => {};
    const source = new HmdCameraSource({
      clock: { now: () => 10 },
      profile: acceptedProfile(),
      performanceNow: () => 10000,
      media: {
        enumerateDevices: async () => [{ kind: "videoinput" } as MediaDeviceInfo],
        getUserMedia: async () =>
          ({
            getVideoTracks: () => [
              {
                getSettings: () => ({ width: 1280, height: 960, frameRate: 30, facingMode: "environment" }),
              },
            ],
            getTracks: () => [{ stop() {} }],
          }) as unknown as MediaStream,
      },
      frames: {
        start(_video, onFrame) {
          emitFrame = onFrame;
        },
        stop() {},
      },
      jpeg: {
        encode: async () => ({ jpeg, width: 1280, height: 960 }),
      },
      videoFactory: () =>
        ({
          srcObject: null,
          play: async () => undefined,
        }) as HTMLVideoElement,
    });
    source.samplePose([0, 0, 0], [0, 0, 0, 1]);
    await source.waitUntilOpen();
    const pending = source.capture();
    emitFrame({} as HTMLVideoElement, { captureTime: 10000 });
    const observation = await pending;
    expect(observation.ts_capture).toBe(10);
    expect(observation.jpeg).toEqual(jpeg);
    expect(observation.intrinsics.width).toBe(1280);
    expect(observation.intrinsics.fx).toBe(600);
  });
});
