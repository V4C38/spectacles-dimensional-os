import { describe, it, expect, vi, beforeEach } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import { Signal } from "../../Assets/Scripts/App/Utilities/Utilities";
import {
  CameraClient,
  CAPTURE_MIN_SPACING_S,
} from "../../Assets/Scripts/ARBridge/Camera/CameraClient";
import { setMockTime } from "../setup/lens-globals";

vi.mock("../../Assets/Scripts/ARBridge/Network/WebSocketTransport", () => ({
  sendBinary: vi.fn(),
}));

import { sendBinary } from "../../Assets/Scripts/ARBridge/Network/WebSocketTransport";

type CameraClientInternals = CameraClient & {
  _captureSpacingDeadline: number;
  _inFlight: boolean;
  _inFlightSeq: number;
  _sentCameraInfo: boolean;
};

function makeClient() {
  const onCameraFrameAck = new Signal<{
    type: "camera_frame_ack";
    seq: number;
    ts: number;
  }>();
  const onHello = new Signal();
  const transportSend = vi.fn();
  const session = {
    isConnected: () => true,
    isClockSyncReady: true,
    activeRobotId: "unitree_go2",
    transport: { send: transportSend },
    mapCaptureTime: (t: number) => t,
    inbound: { onCameraFrameAck, onHello },
  };

  const identityQuat = new quat(1, 0, 0, 0);
  const cameraObject = {
    getTransform: () => ({
      getWorldPosition: () => new vec3(0, 0, 0),
      getWorldRotation: () => identityQuat,
    }),
  };

  const requestNextFrame = vi.fn(async () => ({
    texture: {
      getWidth: () => 100,
      getHeight: () => 100,
    },
    timestampSeconds: 1.0,
  }));

  const camera = {
    deviceCamera: {
      resolution: { x: 100, y: 100 },
      focalLength: { x: 50, y: 50 },
      principalPoint: { x: 50, y: 50 },
      pose: {
        column0: new vec3(1, 0, 0),
        column1: new vec3(0, 1, 0),
        column2: new vec3(0, 0, 1),
        column3: { x: 0, y: 0, z: 0 },
      },
    },
    requestNextFrame,
  };

  const client = new CameraClient({
    session: session as never,
    camera: camera as never,
    getCameraObject: () => cameraObject as never,
  });
  client.bindInbound();
  client.setCaptureEnabled(true);

  return { client, onCameraFrameAck, requestNextFrame, transportSend };
}

async function flushAsyncCapture(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("CameraClient ACK-gated cadence", () => {
  beforeEach(() => {
    vi.mocked(sendBinary).mockClear();
    setMockTime(0);
    (globalThis as Record<string, unknown>).Base64 = {
      encodeTextureAsync: (
        _texture: unknown,
        onSuccess: (base64: string) => void,
        _onError: () => void,
      ) => {
        onSuccess("AQID");
      },
      decode: () => new Uint8Array([1, 2, 3]),
    };
    (globalThis as Record<string, unknown>).CompressionQuality = {
      IntermediateQuality: 0,
    };
    (globalThis as Record<string, unknown>).EncodingType = { Jpg: 0 };
  });

  it("resets spacing deadline when camera_frame_ack arrives", () => {
    const { client, onCameraFrameAck } = makeClient();
    const internals = client as unknown as CameraClientInternals;
    internals._captureSpacingDeadline = 5.0;
    internals._inFlightSeq = 1;

    setMockTime(9.0);
    onCameraFrameAck.emit({ type: "camera_frame_ack", seq: 1, ts: 9.0 });

    expect(internals._captureSpacingDeadline).toBe(9.0);
    expect(internals._inFlight).toBe(false);
  });

  it("waits for ACK before the next capture", async () => {
    const { client, onCameraFrameAck, requestNextFrame } = makeClient();
    const internals = client as unknown as CameraClientInternals;
    internals._sentCameraInfo = true;

    setMockTime(1.0);
    client.recordPose();
    client.tick();
    await flushAsyncCapture();

    expect(requestNextFrame).toHaveBeenCalledTimes(1);
    expect(sendBinary).toHaveBeenCalledTimes(1);
    expect(internals._inFlight).toBe(true);

    setMockTime(1.0 + CAPTURE_MIN_SPACING_S + 0.05);
    client.tick();
    await flushAsyncCapture();
    expect(requestNextFrame).toHaveBeenCalledTimes(1);

    setMockTime(1.1);
    onCameraFrameAck.emit({ type: "camera_frame_ack", seq: 1, ts: 1.1 });
    setMockTime(1.1 + 0.05);
    client.tick();
    await flushAsyncCapture();
    expect(requestNextFrame).toHaveBeenCalledTimes(2);
    expect(sendBinary).toHaveBeenCalledTimes(2);
  });

  it("resetCaptureSpacingDeadline zeroes capture wait", () => {
    const { client } = makeClient();
    const internals = client as unknown as CameraClientInternals;
    internals._captureSpacingDeadline = 100.0;
    setMockTime(5.0);
    client.resetCaptureSpacingDeadline();
    expect(internals._captureSpacingDeadline).toBe(5.0);
  });

  it("sets min spacing deadline at pipeline start", () => {
    const { client, requestNextFrame } = makeClient();
    const internals = client as unknown as CameraClientInternals;
    internals._sentCameraInfo = true;

    setMockTime(2.0);
    client.recordPose();
    client.tick();

    expect(internals._captureSpacingDeadline).toBeCloseTo(2.0 + CAPTURE_MIN_SPACING_S, 5);
    expect(requestNextFrame).toHaveBeenCalledTimes(1);
  });
});
