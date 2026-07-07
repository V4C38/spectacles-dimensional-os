import { describe, it, expect } from "vitest";
import {
  buildCameraFrameBytes,
  parseLidarBinary,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";
import { vec3, quat } from "../shims/lens-runtime";

function f16(bits: number): [number, number] {
  return [bits & 0xff, (bits >> 8) & 0xff];
}

function lidarFrame(ts: number, pts: number[][]): Uint8Array {
  const buf = new Uint8Array(5 + pts.length * 6);
  buf[0] = 0x01;
  new DataView(buf.buffer).setFloat32(1, ts, true);
  let o = 5;
  const map: Record<number, number> = {
    1: 0x3c00,
    [-2]: 0xc000,
    0: 0x0000,
    2: 0x4000,
    0.5: 0x3800,
  };
  for (const [x, y, z] of pts) {
    for (const v of [x, y, z]) {
      const [lo, hi] = f16(map[v]);
      buf[o++] = lo;
      buf[o++] = hi;
    }
  }
  return buf;
}

describe("parseLidarBinary", () => {
  it("decodes type, ts, and float16 xyz points", () => {
    const msg = parseLidarBinary(
      lidarFrame(12.5, [
        [1, -2, 0],
        [2, 0.5, 1],
      ]),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("lidar");
    expect(msg!.ts).toBeCloseTo(12.5, 5);
    expect(msg!.points[0]).toEqual([1, -2, 0]);
    expect(msg!.points[1][2]).toBeCloseTo(1, 5);
    expect(msg).not.toHaveProperty("robot_id");
    expect(msg).not.toHaveProperty("frame");
  });

  it("returns null on short buffer and wrong message type", () => {
    expect(parseLidarBinary(new Uint8Array([0x01, 0, 0]))).toBeNull();
    expect(parseLidarBinary(new Uint8Array([0x02, 0, 0, 0, 0]))).toBeNull();
  });

  it("floors trailing partial point bytes", () => {
    const f = lidarFrame(0, [[1, 1, 1]]);
    const padded = new Uint8Array(f.length + 3);
    padded.set(f);
    expect(parseLidarBinary(padded)!.points.length).toBe(1);
  });

  it("decodes half-float subnormals and specials", () => {
    const sub = parseLidarBinary(lidarFrame(0, [[0, 0, 0]]));
    expect(sub!.points[0]).toEqual([0, 0, 0]);
    const buf = new Uint8Array(5 + 6);
    buf[0] = 0x01;
    for (const [i, bits] of [
      [5, 0x7c00],
      [7, 0xfc00],
      [9, 0x7e00],
    ] as const) {
      buf[i] = bits & 0xff;
      buf[i + 1] = bits >> 8;
    }
    const m = parseLidarBinary(buf)!;
    expect(m.points[0][0]).toBe(Infinity);
    expect(m.points[0][1]).toBe(-Infinity);
    expect(Number.isNaN(m.points[0][2])).toBe(true);
  });
});

describe("buildCameraFrameBytes — binary contract with Python parse_camera_frame", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xaa, 0xff, 0xd9]);
  const out = buildCameraFrameBytes({
    robotId: "go2",
    seq: 7,
    ts: 1.5,
    sendTs: 1.7,
    camPos: new vec3(100, 200, 300),
    camRot: new quat(1, 0, 0, 0),
    jpegBytes: jpeg,
    captureTsRobot: 42.0,
  });

  it("starts with ARF1 magic and little-endian header length", () => {
    expect(Array.from(out.slice(0, 4))).toEqual([0x41, 0x52, 0x46, 0x31]);
    const headerLen =
      out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    const headerJson = JSON.parse(
      new TextDecoder().decode(out.slice(8, 8 + headerLen)),
    );
    expect(headerJson.type).toBe("camera_frame");
    expect(headerJson.robot_id).toBe("go2");
    expect(headerJson.seq).toBe(7);
    expect(headerJson.cam_pos).toEqual([1, 2, 3]);
    expect(headerJson.cam_rot.length).toBe(4);
    expect(headerJson.capture_ts_robot).toBe(42.0);
    expect(Array.from(out.slice(8 + headerLen))).toEqual(Array.from(jpeg));
  });

  it("omits capture_ts_robot when not provided", () => {
    const o2 = buildCameraFrameBytes({
      robotId: "g1",
      seq: 1,
      ts: 0,
      sendTs: 0,
      camPos: new vec3(),
      camRot: new quat(),
      jpegBytes: jpeg,
    });
    const hl = o2[4] | (o2[5] << 8) | (o2[6] << 16) | (o2[7] << 24);
    expect(
      JSON.parse(new TextDecoder().decode(o2.slice(8, 8 + hl))),
    ).not.toHaveProperty("capture_ts_robot");
  });
});
