import { describe, expect, it, afterEach, vi } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import { lookupPoseSample, scaleCameraIntrinsics, specsWorldPoseToTracking, specsCameraOpticalPoseToTracking, type PoseSample, SpecsCameraSource } from "../../Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraSource";
import { rotateVecByQuat } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

describe("camera optical pose", () => {
  it("maps optical right/down/forward to tracking right/down/forward for a level Lens camera", () => {
    const pose = specsCameraOpticalPoseToTracking(new vec3(100, 200, -300), new quat(1, 0, 0, 0));
    expect(pose.position).toEqual([3, -1, 2]);
    expect(rotateVecByQuat(pose.orientation, [1, 0, 0])).toEqual([0, -1, 0]);
    expect(rotateVecByQuat(pose.orientation, [0, 1, 0])).toEqual([0, 0, -1]);
    expect(rotateVecByQuat(pose.orientation, [0, 0, 1])).toEqual([1, 0, 0]);
  });

  it("keeps optical axes correct while looking straight down at a table marker", () => {
    const half = Math.PI / 4;
    const pose = specsCameraOpticalPoseToTracking(new vec3(0, 100, 0), new quat(Math.cos(half), -Math.sin(half), 0, 0));
    const forward = rotateVecByQuat(pose.orientation, [0, 0, 1]);
    expect(forward[0]).toBeCloseTo(0);
    expect(forward[1]).toBeCloseTo(0);
    expect(forward[2]).toBeCloseTo(-1);
  });
});

it("keeps navigation ground poses separate from camera optical axes", () => {
  const pose = specsWorldPoseToTracking(new vec3(100, 200, -300), new quat(1, 0, 0, 0));
  expect(pose.position).toEqual([3, -1, 2]);
  expect(pose.orientation).toEqual([0, 0, 0, 1]);
  expect(rotateVecByQuat(pose.orientation, [0, 0, 1])).toEqual([0, 0, 1]);
});

function sample(t: number, x: number, y: number, z: number): PoseSample {
  return {
    t,
    position: new vec3(x, y, z),
    rotation: new quat(1, 0, 0, 0),
  };
}

describe("lookupPoseSample", () => {
  it("interpolates position between samples", () => {
    const pose = lookupPoseSample([sample(0.95, 0, 0, 0), sample(1.05, 10, 0, 0)], 1);
    expect(pose).not.toBeNull();
    expect(pose!.t).toBe(1);
    expect(pose!.position.x).toBeCloseTo(5, 6);
  });

  it("interpolates exposure across delayed display samples without an extra bracket-age gate", () => {
    const history = [sample(0, 0, 0, 0), sample(2, 10, 0, 0)];
    expect(lookupPoseSample(history, 1)?.position.x).toBeCloseTo(5);
    expect(lookupPoseSample(history, 0.01)?.position.x).toBeCloseTo(0.05);
    expect(lookupPoseSample(history, 1.99)?.position.x).toBeCloseTo(9.95);
  });

  it("returns null when the nearest sample is stale", () => {
    expect(lookupPoseSample([sample(0, 0, 0, 0)], 0.2)).toBeNull();
  });

  it("returns the nearest sample within 0.1 s", () => {
    const pose = lookupPoseSample([sample(1, 3, 0, 0)], 1.05);
    expect(pose).not.toBeNull();
    expect(pose!.position.x).toBeCloseTo(3, 6);
  });
});

describe("scaleCameraIntrinsics", () => {
  it("scales fx fy cx cy to the JPEG texture size", () => {
    const deviceCamera = {
      resolution: { x: 200, y: 100 },
      focalLength: { x: 50, y: 40 },
      principalPoint: { x: 100, y: 50 },
    };
    const texture = { getWidth: () => 100, getHeight: () => 50 };
    expect(scaleCameraIntrinsics(deviceCamera as DeviceCamera, texture as Texture)).toEqual({
      fx: 25,
      fy: 20,
      cx: 50,
      cy: 25,
      width: 100,
      height: 50,
      distortion_model: "none",
      distortion: [],
    });
  });
});



import { setMockTime } from "../setup/lens-globals";
afterEach(() => vi.unstubAllGlobals());
it("settles capture on stop during JPEG encoding and ignores the retired native callback", async () => {
  const { source, stream, callbacks } = encodingFixture();
  const capture = source.capture(), result = vi.fn(); capture.then(result, () => {}); await Promise.resolve();
  const rejected = expect(capture).rejects.toThrow("stopped"); source.stop(); await rejected;
  callbacks[0]("jpeg"); await Promise.resolve(); await Promise.resolve();
  expect(result).not.toHaveBeenCalled(); expect(stream.stop).toHaveBeenCalledOnce();
});

function encodingFixture() {
  const callbacks: ((value: string) => void)[] = [];
  vi.stubGlobal("Base64", { encodeTextureAsync: (_texture: unknown, success: (value: string) => void) => callbacks.push(success),
    decode: () => new Uint8Array([1, 2, 3]) });
  vi.stubGlobal("CompressionQuality", { IntermediateQuality: 1 }); vi.stubGlobal("EncodingType", { Jpg: 1 });
  const texture = { getWidth: () => 100, getHeight: () => 100 };
  const stream = { start: vi.fn(), stop: vi.fn(), requestNextFrame: vi.fn(async () => ({ texture, timestampSeconds: 10 })),
    deviceCamera: { pose: null, resolution: { x: 100, y: 100 }, focalLength: { x: 50, y: 50 }, principalPoint: { x: 50, y: 50 } } };
  const source = new SpecsCameraSource({ stream: stream as any,
    cameraObject: { getTransform: () => ({ getWorldPosition: () => vec3.zero(), getWorldRotation: () => quat.quatIdentity() }) } as any });
  setMockTime(10); source.samplePose(); source.start();
  return { source, stream, callbacks, texture };
}
it("checks capture eligibility before starting the expensive native JPEG encoder", async () => {
  const f = encodingFixture();
  await expect(f.source.capture(() => false)).rejects.toThrow("no longer eligible");
  expect(f.callbacks).toHaveLength(0); expect(f.source.diagnostics().encodes).toBe(0);
  f.source.stop();
});
it("does not encode a frame when the gate closes while waiting for pixels", async () => {
  const f = encodingFixture(); let eligible = true;
  let frame!: (value: { texture: any; timestampSeconds: number }) => void;
  f.stream.requestNextFrame.mockImplementation(() => new Promise(resolve => { frame = resolve; }));
  const capture = f.source.capture(() => eligible);
  eligible = false; frame({ texture: f.texture, timestampSeconds: 10 });
  await expect(capture).rejects.toThrow("no longer eligible");
  expect(f.callbacks).toHaveLength(0); f.source.stop();
});
it("serializes native encodes across cancellation and requests fresh pixels for the new generation", async () => {
  const f = encodingFixture(); const first = f.source.capture(); first.catch(() => {});
  await Promise.resolve(); expect(f.callbacks).toHaveLength(1);
  f.source.stop(); await expect(first).rejects.toThrow("stopped");
  f.source.start(); const second = f.source.capture();
  await Promise.resolve(); expect(f.callbacks).toHaveLength(1);
  f.callbacks[0]("jpeg");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(f.stream.requestNextFrame).toHaveBeenCalledTimes(2);
  expect(f.callbacks).toHaveLength(2); f.callbacks[1]("jpeg"); await second;
  expect(f.source.diagnostics()).toMatchObject({ maxInFlight: 1, inFlight: 0, encodes: 2, discarded: 1 });
  f.source.stop();
});

import { CAMERA_HISTORY_TRACE } from "../../../core/tests/support/CameraHistoryTrace";
it.each(CAMERA_HISTORY_TRACE)("camera adapter contract: $name", trace => {
  const result = lookupPoseSample(trace.times.map((t, index) => sample(t, index * 100, 0, 0)), trace.timestamp);
  if (trace.expectedX === null) expect(result).toBeNull();
  else expect(result!.position.x / 100).toBeCloseTo(trace.expectedX);
});
