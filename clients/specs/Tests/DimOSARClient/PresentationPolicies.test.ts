import { expect, it, vi } from "vitest";
import { NotificationCenter } from "../../Assets/Scripts/DimOSARClient/presentation/NotificationCenter";
import { SetupFlow } from "../../Assets/Scripts/DimOSARClient/presentation/SetupFlow";
import { LidarDisplayController } from "../../Assets/Scripts/DimOSARClient/sensors/LidarDisplayController";
import { worldMarkerHover, circleStrokeSegments } from "../../Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle";

it("links marker and robot hover only while attached, without changing either actual target", () => {
  expect(worldMarkerHover(true, true, false)).toEqual({ robot: true, marker: true });
  expect(worldMarkerHover(true, false, true)).toEqual({ robot: true, marker: true });
  expect(worldMarkerHover(false, true, false)).toEqual({ robot: true, marker: false });
  expect(worldMarkerHover(false, false, true)).toEqual({ robot: false, marker: true });
  expect(worldMarkerHover(true, false, false)).toEqual({ robot: false, marker: false });
});

it("joins physical circle stroke segments continuously without radius-dependent dash scaling", () => {
  const points = circleStrokeSegments(0.2144);
  expect(points).toHaveLength(256);
  for (let i = 0; i < points.length; i++) {
    expect(Math.hypot(points[i][0], points[i][2])).toBeCloseTo(0.2144);
    if (i % 2 && i + 1 < points.length) expect(points[i]).toEqual(points[i + 1]);
  }
  expect(points.at(-1)![0]).toBeCloseTo(points[0][0]);
  expect(points.at(-1)![2]).toBeCloseTo(points[0][2]);
});

it("preempts notifications by priority and refreshes a repeated urgent message", () => {
  const center = new NotificationCenter();
  center.show({ text: "Stop requested", priority: 100 }); center.tick(2);
  center.show({ text: "Ordinary", priority: 0 }); expect(center.snapshot().notification?.text).toBe("Stop requested");
  center.show({ text: "Stop requested", priority: 100 }); center.tick(1);
  expect(center.snapshot().notification).not.toBeNull(); center.tick(1.5); expect(center.snapshot().notification).toBeNull();
});

it("shares setup capture, skip, and review transitions without platform dependencies", () => {
  const view = { connection: "ready", hasTrackingOrigin: false, capabilities: { localization: { available: true } } };
  const episode = { pause: vi.fn(), requestStart: vi.fn() };
  const flow = new SetupFlow({ view: () => view, stop: vi.fn() } as never, episode);
  flow.startLocalization(); expect(flow.step).toBe("localization"); expect(episode.requestStart).toHaveBeenCalledOnce();
  flow.finish(); expect(flow.completed).toBe(true); expect(episode.pause).toHaveBeenCalledOnce();
  flow.requestAlignmentReview("tracking-loss"); flow.dismissAlignmentReview(); expect(flow.alignmentReview?.pending).toBe(false);
  flow.restart(); expect(flow.completed).toBe(false); expect(flow.step).toBe("connect");
});

it("keeps sensor point limits local and changes mode only after authoritative state", () => {
  const view = { connection: "ready", capabilities: { lidar: { available: true } }, hello: { robot: { body_bounds_m: [0.7, 0.5, 0.55] } },
    state: { lidar: { enabled: false, min_height_m: 0, max_height_m: 0, max_range_m: 0 } } };
  const sendText = vi.fn();
  const session = { view: () => view, sendText };
  const write = vi.fn();
  const sensors = new LidarDisplayController(session as never, { read: () => null, write });
  const acknowledge = () => { const { type, ...lidar } = JSON.parse(sendText.mock.calls.at(-1)![0]); view.state = { lidar }; sensors.observe(view as never); };
  sensors.setMode("full"); expect(sensors.mode).toBe("off"); acknowledge();
  sensors.adjustRange(-1); acknowledge(); sensors.adjustPoints(-1);
  expect(sendText).toHaveBeenCalledTimes(2); expect(sensors.preferences.pointLimit).toBe(3750);
  sensors.setMode("obstacles"); acknowledge(); sensors.adjustRange(1); acknowledge();
  expect(sensors.preferences.obstacleRangeM).toBe(0.7);
  sensors.setMode("full"); expect(JSON.parse(sendText.mock.calls.at(-1)![0]).max_range_m).toBe(4.5);
  expect(write).toHaveBeenCalled();
});

it("derives LiDAR mode across delayed state, capability loss and reconnect without persisting duplicate facts", () => {
  const off = { enabled: false, min_height_m: 0, max_height_m: 0, max_range_m: 0 };
  const view = { connection: "ready", capabilities: { lidar: { available: true } }, state: { lidar: off } };
  const sendText = vi.fn(), write = vi.fn();
  const sensors = new LidarDisplayController({ view: () => view, sendText } as never, { read: () => null, write });
  sensors.observe(view as never); sensors.setMode("full");
  sensors.observe({ ...view, state: { lidar: { ...off } } } as never);
  expect(sensors.mode).toBe("off"); expect(write).not.toHaveBeenCalled();
  view.state = { lidar: { enabled: true, min_height_m: 0.1, max_height_m: 2, max_range_m: 4 } };
  sensors.observe(view as never); expect(sensors.mode).toBe("full"); expect(write).toHaveBeenCalledOnce();
  sensors.observe({ ...view, state: { ...view.state } } as never); expect(write).toHaveBeenCalledOnce();
  view.connection = "failed"; expect(sensors.mode).toBe("off");
  view.connection = "ready"; view.state = { lidar: off }; expect(sensors.mode).toBe("off");
  view.capabilities.lidar.available = false; sensors.setMode("full"); expect(sendText).toHaveBeenCalledOnce();
});

it("exposes setup facts through detached readonly snapshots and explicit transitions", () => {
  const episode = { pause: vi.fn(), requestStart: vi.fn() };
  const flow = new SetupFlow({ view: () => ({ connection: "ready", capabilities: { localization: { available: true } }, hasTrackingOrigin: false }) } as never, episode);
  flow.showStep("localization"); expect(episode.requestStart).not.toHaveBeenCalled();
  flow.showStep("connect"); expect(episode.pause).toHaveBeenCalledOnce();
  flow.requestAlignmentReview("resume");
  const copy = flow.snapshot(); (copy.alignmentReview as { pending: boolean }).pending = false;
  expect(flow.alignmentReview?.pending).toBe(true);
  flow.clearAlignmentReview(); expect(flow.alignmentReview).toBeNull();
});
