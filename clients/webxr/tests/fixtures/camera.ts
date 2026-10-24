import { vi } from "vitest";
import { HmdCameraSource, type VideoFrameMetadata } from "../../src/localization/HmdCameraSource";
import { acceptProfile } from "../../src/localization/HmdCalibrationRunner";
import { HMD_PROFILES } from "../../src/localization/HmdProfiles";
import type { HmdCalibrationProfile } from "../../src/localization/HmdCalibration";

export function acceptedProfile(): HmdCalibrationProfile {
  return acceptProfile({
    ...HMD_PROFILES.quest3, cameraLabel: "Left physical camera",
    T_viewer_optical: { position: [0, 0, 0], orientation: [1, 0, 0, 0] },
    intrinsics: { ...HMD_PROFILES.quest3.intrinsics, fx: 600, fy: 600 },
  }, {
    accepted: true, meanReprojectionPx: 0.2, maxReprojectionPx: 0.4,
    maxOriginErrorM: 0.01, maxHeadingErrorDeg: 1, observationCount: 4, reasons: [],
  }, "2026-09-14T00:00:00Z");
}

export function cameraFixture(profile = acceptedProfile(), clock = { now: () => 10 }) {
  const stopped = vi.fn();
  let emit = (_video: HTMLVideoElement, _metadata: VideoFrameMetadata): void => {};
  const track = { label: "Left physical camera", getSettings: () => ({ width: 1280, height: 960, frameRate: 30, facingMode: "environment", deviceId: "physical-left" }), stop: stopped };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const media = {
    enumerateDevices: vi.fn(async () => [{ kind: "videoinput", label: "Left physical camera", deviceId: "physical-left" } as MediaDeviceInfo]),
    getUserMedia: vi.fn(async (_constraints: MediaStreamConstraints) => stream),
  };
  const jpeg = { encode: vi.fn(async () => ({ jpeg: new Uint8Array([0xff, 0xd8]), width: 1280, height: 960 })) };
  const frames = { start: vi.fn((_video: HTMLVideoElement, onFrame: typeof emit) => { emit = onFrame; }), stop: vi.fn() };
  const video = { srcObject: null, play: vi.fn<() => Promise<void>>(async () => {}), pause: vi.fn() };
  const source = new HmdCameraSource({
    clock, profile, performanceNow: () => 10000, media, jpeg, frames,
    videoFactory: () => video as unknown as HTMLVideoElement,
  });
  source.samplePose([0, 0, 0], [0, 0, 0, 1]);
  return { source, media, jpeg, frames, track, stream, video, stopped, emit: () => emit({} as HTMLVideoElement, { captureTime: 10000 }) };
}

