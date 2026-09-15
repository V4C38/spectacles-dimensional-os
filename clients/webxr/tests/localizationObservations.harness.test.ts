import { describe, expect, it } from "vitest";
import {
  decodeLocalizationObservations,
  encodeLocalizationObservations,
} from "@dimos-ar-client/websocket/protocol";
import { HmdCameraSource, type VideoFrameMetadata } from "../src/camera/HmdCameraSource";
import { acceptProfile } from "../src/camera/calibrationRunner";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";

describe("localization_observations harness", () => {
  it("encodes a captured observation with ClientCore byte compatibility", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0, 1, 0xd9]);
    let emitFrame = (_video: HTMLVideoElement, _metadata: VideoFrameMetadata): void => {};
    const source = new HmdCameraSource({
      clock: { now: () => 3.25 },
      profile: acceptProfile(
        {
          ...HMD_PROFILES.quest3,
          intrinsics: { ...HMD_PROFILES.quest3.intrinsics, fx: 500, fy: 510 },
        },
        {
          accepted: true,
          meanReprojectionPx: 0,
          maxReprojectionPx: 0,
          maxOriginErrorM: 0,
          observationCount: 4,
          reasons: [],
        },
        "2026-09-14T00:00:00Z",
      ),
      performanceNow: () => 3250,
      media: {
        enumerateDevices: async () => [{ kind: "videoinput" } as MediaDeviceInfo],
        getUserMedia: async () =>
          ({
            getVideoTracks: () => [
              {
                getSettings: () => ({
                  width: 1280,
                  height: 960,
                  frameRate: 30,
                  facingMode: "environment",
                }),
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
      jpeg: { encode: async () => ({ jpeg, width: 1280, height: 960 }) },
      videoFactory: () => ({ srcObject: null, play: async () => undefined }) as HTMLVideoElement,
    });
    source.samplePose([0, 1.4, 0], [0, 0, 0, 1]);
    await source.waitUntilOpen();
    const pending = source.capture();
    emitFrame({} as HTMLVideoElement, { captureTime: 3250 });
    const observation = await pending;
    const decoded = decodeLocalizationObservations(encodeLocalizationObservations([observation]));
    expect(decoded.type).toBe("localization_observations");
    expect(decoded.observations[0].ts_capture).toBe(3.25);
    expect(decoded.observations[0].jpeg).toEqual(jpeg);
    expect(decoded.observations[0].intrinsics.fx).toBe(500);
    expect(decoded.observations[0].intrinsics.fy).toBe(510);
    expect(decoded.observations[0].intrinsics.width).toBe(1280);
  });
});
