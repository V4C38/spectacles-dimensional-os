import { expect, it, vi } from "vitest";
import { NavigationPreviewCoordinator } from "../../Assets/Scripts/DimOSARClient/navigation/NavigationPreviewCoordinator";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";

function fixture() {
  const view = { connection: "ready", capabilities: { navigation: { available: true, nav_goal: { available: true, preview: true } } }, state: null, nav_preview: null } as unknown as ARModuleSessionState;
  const sendText = vi.fn();
  const coordinator = new NavigationPreviewCoordinator({ view: () => view, sendText });
  const origin = { position: [1, 2, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 1 };
  coordinator.apply(origin);
  const aim = (x = 2) => coordinator.aim([x, 0, 0], [0, 0, 0, 1]);
  const id = () => JSON.parse(sendText.mock.calls.at(-1)![0]).preview_id;
  const reply = (preview_id: string | undefined) => {
    view.nav_preview = { type: "nav_goal", preview: true, preview_id, pose: [3, 2, 0, 0], path_poses: [[3, 2, 0, 0]], ts: 1 };
    coordinator.apply(origin);
  };
  return { view, sendText, coordinator, origin, aim, id, reply };
}

it("retires timeouts, rejects late replies and only accepts the newest correlated aim", () => {
  const f = fixture(); f.aim(); f.coordinator.tick(0); const old = f.id();
  expect(JSON.parse(f.sendText.mock.calls[0][0]).position).toEqual([3, 2, 0]);
  f.aim(4); f.coordinator.tick(4.9); expect(f.sendText).toHaveBeenCalledOnce();
  f.coordinator.tick(5); const current = f.id(); expect(current).not.toBe(old);
  f.reply(old); expect(f.coordinator.previewPath()).toBeNull();
  f.coordinator.tick(5.5); expect(f.sendText).toHaveBeenCalledTimes(2);
  f.reply(current); expect(f.coordinator.previewPath()).toEqual([[3, 2, 0, 0]]);
  f.coordinator.clear(); expect(f.coordinator.previewPath()).toBeNull();
});

it("invalidates costmap and origin generations, suppresses stale aim episodes and resets on disconnect", () => {
  const f = fixture(); f.aim(); f.coordinator.tick(0); const old = f.id();
  f.coordinator.clear(); f.aim(5); f.reply(old); expect(f.coordinator.previewPath()).toBeNull();
  f.coordinator.tick(0.5); const pending = f.id();
  f.view.state = { nav_preview_costmap_ts: 2 } as ARModuleSessionState["state"];
  f.coordinator.apply(f.origin); f.reply(pending); expect(f.coordinator.previewPath()).toBeNull();
  f.coordinator.tick(1); const beforeOrigin = f.id();
  f.coordinator.apply({ ...f.origin, ts: 2 }); f.reply(beforeOrigin); expect(f.coordinator.previewPath()).toBeNull();
  f.view.connection = "disconnected"; f.coordinator.apply(null);
  f.view.connection = "ready"; f.view.nav_preview = null; f.coordinator.apply(f.origin);
  f.aim(); f.coordinator.tick(2); expect(f.sendText).toHaveBeenCalledTimes(4);
});

it("gates unsupported and legacy servers and keeps confirmation outside preview ownership", () => {
  const f = fixture();
  f.view.capabilities!.navigation.nav_goal.preview = false;
  f.aim(); f.coordinator.tick(0); expect(f.sendText).not.toHaveBeenCalled();
  f.view.capabilities!.navigation.nav_goal.preview = true;
  f.coordinator.tick(1); f.reply(undefined); f.aim(8); f.coordinator.tick(10);
  expect(f.sendText).toHaveBeenCalledOnce(); expect(f.coordinator.previewPath()).toBeNull();
});

it("retains a successful route while newer aims and costmaps are pending, but clears on failure or timeout", () => {
  const f = fixture(); f.aim(); f.coordinator.tick(0); f.reply(f.id());
  const path = f.coordinator.previewPath();
  f.aim(4); expect(f.coordinator.previewPath()).toBe(path);
  f.coordinator.tick(0.4); const obsolete = f.id();
  f.aim(5); f.reply(obsolete); expect(f.coordinator.previewPath()).toBe(path);
  f.coordinator.tick(0.8);
  f.view.state = { nav_preview_costmap_ts: 3 } as ARModuleSessionState["state"];
  f.coordinator.apply(f.origin); expect(f.coordinator.previewPath()).toBe(path);
  f.reply(f.id()); expect(f.coordinator.previewPath()).toBe(path);
  f.coordinator.tick(1.2); const current = f.id();
  f.view.nav_preview = { type: "nav_goal", preview: true, preview_id: current, pose: null, path_poses: [], ts: 3 };
  f.coordinator.apply(f.origin); expect(f.coordinator.previewPath()).toEqual([]);
  f.aim(6); f.coordinator.tick(1.6); f.reply(f.id());
  f.aim(7); f.coordinator.tick(2); expect(f.coordinator.previewPath()).not.toBeNull();
  f.coordinator.tick(7); expect(f.coordinator.previewPath()).toBeNull();
});

it("clears retained previews immediately on origin change and capability loss", () => {
  const f = fixture(); f.aim(); f.coordinator.tick(0); f.reply(f.id());
  f.coordinator.apply({ ...f.origin, ts: 2 }); expect(f.coordinator.previewPath()).toBeNull();
  f.coordinator.apply(f.origin); f.aim(); f.coordinator.tick(0.5); f.reply(f.id());
  f.view.capabilities!.navigation.nav_goal.preview = false;
  f.coordinator.apply(f.origin); expect(f.coordinator.previewPath()).toBeNull();
});
