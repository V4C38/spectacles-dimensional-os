import { expect, it, vi } from "vitest";
import { NotificationCenter } from "../../Assets/Scripts/DimOSARClient/presentation/NotificationCenter";
import { SetupFlow } from "../../Assets/Scripts/DimOSARClient/presentation/SetupFlow";
import { LidarDisplayController } from "../../Assets/Scripts/DimOSARClient/sensors/LidarDisplayController";

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

it("keeps sensor point limits local and remembers each mode's range independently", () => {
  const sendText = vi.fn();
  const session = { view: () => ({ connection: "ready", capabilities: { lidar: { available: true } }, hello: { robot: { body_bounds_m: [0.7, 0.5, 0.55] } } }), sendText };
  const write = vi.fn();
  const sensors = new LidarDisplayController(session as never, { read: () => null, write });
  sensors.setMode("full"); sensors.adjustRange(-1); sensors.adjustPoints(-1);
  expect(sendText).toHaveBeenCalledTimes(2); expect(sensors.preferences.pointLimit).toBe(3750);
  sensors.setMode("obstacles"); sensors.adjustRange(1); expect(sensors.preferences.obstacleRangeM).toBe(0.7);
  sensors.setMode("full"); expect(JSON.parse(sendText.mock.calls.at(-1)![0]).max_range_m).toBe(4.5);
  expect(write).toHaveBeenCalled();
});
