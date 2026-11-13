import { immediateAuthority } from "./support/ImmediateAuthority";
import { expect, it, vi } from "vitest";
import { NavigationPreviewCoordinator } from "../src/navigation/NavigationPreviewCoordinator";
import type { ARModuleSessionState } from "../src/websocket/arModuleSession";

function fixture() {
  let now = 0;
  const view = { connection: "ready", capabilities: { navigation: { available: true, nav_goal: { available: true, preview: true } } }, state: null, nav_preview: null } as unknown as ARModuleSessionState;
  const sendText = vi.fn();
  const assets = new Map<string, number>();
  const authority = immediateAuthority({ now: () => now });
  authority.begin("navigation_planning", { position: [3, 2, 0], orientation: [0, 0, 0, 1] });
  const coordinator = new NavigationPreviewCoordinator({ view: () => view, sendText, collaboration: authority.collaboration, assetTransferDeadline: id => assets.get(id) ?? null });
  const origin = { position: [1, 2, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 1 };
  coordinator.apply(origin);
  const aim = (x = 2) => coordinator.aim([x, 0, 0], [0, 0, 0, 1]);
  const tick = (time: number) => { now = time; authority.tick(); coordinator.tick(time); };
  const id = () => JSON.parse(sendText.mock.calls.at(-1)![0]).preview_id;
  const reply = (preview_id: string | undefined) => {
    view.nav_preview = { type: "nav_goal", preview: true, preview_id, pose: [3, 2, 0, 0], path_poses: [[3, 2, 0, 0]], ts: now };
    coordinator.apply(origin);
  };
  return { view, sendText, coordinator, origin, aim, tick, id, reply, assets, authority };
}

it("requests the acknowledged canonical pose rather than a rendered aim", () => {
  const f = fixture(); f.aim(10); f.tick(0);
  expect(JSON.parse(f.sendText.mock.calls[0][0])).toMatchObject({
    position: [3, 2, 0], epoch: "test-epoch", lease_id: "test-lease-1",
  });
});

it("keeps one request pending until its matching reply or deadline and ignores old replies", () => {
  const f = fixture(); f.aim(); f.tick(0); const old = f.id();
  f.reply("unrelated"); f.tick(4.9); expect(f.sendText).toHaveBeenCalledOnce();
  f.tick(5); const current = f.id(); expect(current).not.toBe(old);
  f.reply(old); f.tick(5.5); expect(f.sendText).toHaveBeenCalledTimes(2);
  f.reply(current); f.tick(6); expect(f.sendText).toHaveBeenCalledTimes(3);
});

it("serializes a changed aim behind its pending request and then refreshes the canonical target", () => {
  const f = fixture(); f.aim(); f.tick(0); const pending = f.id();
  f.aim(4); f.tick(.1); expect(f.sendText).toHaveBeenCalledOnce();
  f.reply(pending);
  f.authority.collaboration.update({ position: [5, 2, 0], orientation: [0, 0, 0, 1] });
  f.tick(.4);
  expect(f.sendText).toHaveBeenCalledTimes(2);
  expect(JSON.parse(f.sendText.mock.calls[1][0]).position).toEqual([5, 2, 0]);
});

it("keeps a cleared request serialized across a new aim until its reply", () => {
  const f = fixture(); f.aim(); f.tick(0); const old = f.id();
  f.coordinator.clear(); f.aim(5); f.tick(.2); expect(f.sendText).toHaveBeenCalledOnce();
  f.reply(old); f.tick(.5); expect(f.sendText).toHaveBeenCalledTimes(2);
});

it("refreshes changing costmaps without starving correlated replies", () => {
  const f = fixture(); f.aim();
  for (let i = 0; i < 10; i++) {
    f.tick(i * .5); expect(f.sendText).toHaveBeenCalledTimes(i + 1);
    f.view.state = { nav_preview_costmap_ts: i + 1 } as ARModuleSessionState["state"];
    f.coordinator.apply(f.origin); f.reply(f.id());
  }
});

it("queues an origin refresh and gates capability or connection loss", () => {
  const f = fixture(); f.aim(); f.tick(0); const pending = f.id();
  f.coordinator.apply({ ...f.origin, ts: 2 }); f.reply(pending); f.tick(.5);
  expect(f.sendText).toHaveBeenCalledTimes(2);
  f.view.capabilities!.navigation.nav_goal.preview = false;
  f.coordinator.apply(f.origin); f.tick(1); expect(f.sendText).toHaveBeenCalledTimes(2);
  f.view.connection = "disconnected"; f.coordinator.apply(null);
  f.view.connection = "ready"; f.view.capabilities!.navigation.nav_goal.preview = true;
  f.coordinator.apply(f.origin); f.aim(); f.tick(2);
  expect(f.sendText).toHaveBeenCalledTimes(3);
});

it("extends request correlation through its bounded bulk deadline", () => {
  const f = fixture(); f.aim(); f.tick(0); const pending = f.id();
  f.assets.set(pending, 15); f.tick(6); expect(f.sendText).toHaveBeenCalledOnce();
  f.reply(pending); f.tick(6.5); expect(f.sendText).toHaveBeenCalledTimes(2);
});

it("retires an expired bulk request and prevents its late reply releasing a successor", () => {
  const f = fixture(); f.aim(); f.tick(0); const old = f.id();
  f.assets.set(old, 15); f.tick(15); expect(f.id()).not.toBe(old);
  f.reply(old); f.tick(15.5); expect(f.sendText).toHaveBeenCalledTimes(2);
});

it("retains the last path during refresh, but clears it when interaction authority ends", () => {
  const f = fixture();
  const path = [[1, 2, 0, 0], [3, 2, 0, 0]] as [number, number, number, number][];
  f.authority.state.preview = { type: "nav_goal", pose: [3, 2, 0, 0], path_poses: path, ts: 0 };
  f.authority.publish();
  expect(f.coordinator.displayPath()).toEqual(path);
  f.authority.state.preview = null; f.authority.publish();
  expect(f.coordinator.displayPath()).toEqual(path);
  f.authority.state.authority = null; f.authority.publish();
  expect(f.coordinator.displayPath()).toBeNull();
});
