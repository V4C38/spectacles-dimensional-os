import { expect, it, vi } from "vitest";
import { NavigationInteraction } from "../../Assets/Scripts/DimOSARClient/navigation/NavigationInteraction";
import { NavigationPreviewCoordinator } from "../../Assets/Scripts/DimOSARClient/navigation/NavigationPreviewCoordinator";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";

function fixture() {
  const view = { connection: "ready", hasTrackingOrigin: true, capabilities: { navigation: { available: true, nav_goal: { available: true, preview: false } }, estop: { available: true } }, nav: null, nav_goal: null } as unknown as ARModuleSessionState;
  const commands = { sendGoal: vi.fn(), cancel: vi.fn() };
  const core = new NavigationInteraction(commands, new NavigationPreviewCoordinator({ view: () => view, sendText: vi.fn() }));
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  core.applyView(view, origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 0);
  const point = (x = 2, y = 0) => ({ position: [x, y, 0] as [number, number, number], blocked: false });
  return { core, commands, point, view, origin };
}

it("rejects unselected floor gestures and previews on the first click and sends once on the second", () => {
  const f = fixture(); f.core.hold(0, f.point(), false); f.core.release(0.1, f.point());
  expect(f.commands.sendGoal).not.toHaveBeenCalled();
  f.core.setSelected(true); f.core.aim(0.2, f.point()); f.core.hold(0.3, f.point(), false); f.core.release(0.4, f.point());
  expect(f.commands.sendGoal).not.toHaveBeenCalled();
  expect(f.core.snapshot().placementStage).toBe("preview");
  f.core.hold(0.5, f.point(), false); f.core.release(0.6, f.point());
  expect(f.commands.sendGoal.mock.calls).toEqual([[{ position: [2, 0, 0], orientation: [0, 0, 0, 1] }]]);
  expect(f.core.isAiming()).toBe(false);
});

it("turns while aiming in canonical XY, freezes heading on press, and cancels without sending", () => {
  const f = fixture(); f.core.setSelected(true); f.core.aim(0, f.point());
  f.core.hold(0, f.point(), false); f.core.release(0.1, f.point());
  f.core.aim(1, f.point(2, 1));
  const heading = f.core.snapshot().orientation;
  f.core.hold(1, f.point(2, 1), false); f.core.hold(2, f.point(3, 2), false);
  expect(f.core.snapshot().orientation).toEqual(heading);
  expect(f.core.snapshot().position).toEqual([2, 1, 0]);
  expect(f.core.snapshot().orientation[2]).toBeCloseTo(Math.SQRT1_2, 2);
  f.core.setSelected(false); expect(f.commands.sendGoal).not.toHaveBeenCalled();
  expect(f.core.snapshot().position).toEqual([0, 0, 0]);
  f.core.setSelected(true); f.core.aim(2, f.point()); f.core.clearAim();
  expect(f.core.snapshot().position).toEqual([0, 0, 0]);
});

it("keeps marker dragging live without selection and restores the latest authoritative pose after aim", () => {
  const f = fixture(); f.core.hold(0, f.point()); f.core.hold(1, f.point(3));
  expect(f.commands.sendGoal).toHaveBeenCalled();
  f.core.release(1.1, f.point(3));
  f.core.setSelected(true); f.core.aim(2, f.point(5));
  f.view.nav_goal = { type: "nav_goal", pose: [4, 2, 0, 0], path_poses: [[4, 2, 0, 0]], ts: 2 };
  f.core.applyView(f.view, f.origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 2);
  f.core.clearAim(); expect(f.core.snapshot().position).toEqual([4, 2, 0]);
});

it("exposes attachment and manipulation facts independently of authoritative following state", () => {
  const f = fixture(); expect(f.core.snapshot().attachedToRobot).toBe(true);
  f.core.setSelected(true); f.core.aim(1, f.point()); expect(f.core.snapshot().attachedToRobot).toBe(true);
  expect(f.core.snapshot().probePosition).toEqual([2, 0, 0]);
  f.core.hold(2, f.point(), false); expect(f.core.snapshot().placementHeld).toBe(true);
  f.core.cancelDrag(); expect(f.core.snapshot().attachedToRobot).toBe(true);
  f.view.nav = { state: "following_path", outcome: null };
  f.core.applyView(f.view, f.origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 3);
  expect(f.core.snapshot().followingPath).toBe(true); expect(f.core.snapshot().attachedToRobot).toBe(false);
  expect(f.commands.sendGoal).not.toHaveBeenCalled();
});

it("retains an executing route across empty updates and clears it for a different goal, cancellation and terminal states", () => {
  const f = fixture();
  const path: [number, number, number, number][] = [[0, 0, 0, 0], [2, 0, 0, 0]];
  f.view.nav = { state: "following_path", outcome: null };
  f.view.nav_goal = { type: "nav_goal", pose: [2, 0, 0, 0], path_poses: path, ts: 1 };
  const apply = () => f.core.applyView(f.view, f.origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
  apply(); expect(f.core.activePath()).toBe(path);
  f.view.nav_goal = { type: "nav_goal", pose: null, path_poses: [], ts: 2 };
  apply(); expect(f.core.activePath()).toBe(path);
  f.core.setSelected(true); f.core.aim(1, f.point(4)); f.core.clearAim();
  expect(f.core.snapshot().position).toEqual([2, 0, 0]);
  f.view.nav_goal = { type: "nav_goal", pose: [3, 0, 0, 0], path_poses: [], ts: 3 };
  apply(); expect(f.core.activePath()).toBeNull();
  f.view.nav_goal.path_poses = path; apply(); expect(f.core.activePath()).toBe(path);
  f.core.cancel(2); expect(f.core.activePath()).toBeNull();
  f.core.tick(4); f.view.nav = { state: "resolved", outcome: "succeeded" };
  apply(); expect(f.core.activePath()).toBeNull();
  expect(f.commands.sendGoal).not.toHaveBeenCalled();
});

function liveFixture() {
  const f = fixture();
  f.view.nav = { state: "following_path", outcome: null };
  f.view.nav_goal = { type: "nav_goal", pose: [2, 0, 0, 0], path_poses: [[0, 0, 0, 0], [2, 0, 0, 0]], ts: 1 };
  const apply = () => f.core.applyView(f.view, f.origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
  apply();
  return { ...f, apply };
}

it("keeps an executing goal and route during the probe and follows aim after the first click", () => {
  const f = liveFixture(); f.core.setSelected(true); f.core.aim(1, f.point(4));
  expect(f.core.snapshot().position).toEqual([2, 0, 0]); expect(f.core.activePath()).toHaveLength(2);
  expect(f.core.isAiming()).toBe(false);
  f.core.hold(1.1, f.point(4), false); f.core.release(1.2, f.point(4));
  f.core.aim(1.3, f.point(5)); expect(f.core.snapshot().position).toEqual([5, 0, 0]);
  f.core.clearAim(); expect(f.core.snapshot().position).toEqual([2, 0, 0]);
  expect(f.commands.cancel).not.toHaveBeenCalled(); expect(f.commands.sendGoal).not.toHaveBeenCalled();
});

it.each(["succeeded", "failed"] as const)("plays %s once at the goal, pauses without visible frames, then reattaches despite retained facts", outcome => {
  const f = liveFixture(); f.view.nav = { state: "resolved", outcome }; f.apply();
  const id = f.core.snapshot().feedbackId;
  expect(f.core.flash()).toBe(outcome); expect(f.core.snapshot().position).toEqual([2, 0, 0]);
  expect(f.core.snapshot().attachedToRobot).toBe(false);
  f.core.tick(100); f.apply(); expect(f.core.snapshot().feedbackProgress).toBe(0);
  expect(f.core.snapshot().feedbackId).toBe(id);
  f.core.tick(101, 0.5); expect(f.core.flash()).toBe(outcome);
  f.core.tick(102, 0.25); f.apply();
  expect(f.core.flash()).toBeNull(); expect(f.core.snapshot().attachedToRobot).toBe(true);
  expect(f.core.snapshot().position).toEqual([0, 0, 0]); expect(f.core.activePath()).toBeNull();
});

it("interrupts feedback for a newer goal at the same destination and rejects older frames", () => {
  const f = liveFixture(); f.core.cancel(2); f.apply(); expect(f.core.flash()).toBe("cancelled");
  f.view.nav_goal = { ...f.view.nav_goal!, ts: 0 }; f.apply(); expect(f.core.flash()).toBe("cancelled");
  f.view.nav_goal = { ...f.view.nav_goal!, ts: 3 }; f.apply();
  expect(f.core.flash()).toBeNull(); expect(f.core.snapshot().goalActive).toBe(true);
  expect(f.core.snapshot().position).toEqual([2, 0, 0]);
});

it("does not treat proximity or transient empty paths as success", () => {
  const f = liveFixture(); f.view.nav_goal = { type: "nav_goal", pose: null, path_poses: [], ts: 2 };
  f.core.applyView(f.view, f.origin, { position: [2, 0, 0], orientation: [0, 0, 0, 1] }, 2);
  expect(f.core.flash()).toBeNull(); expect(f.core.snapshot().followingPath).toBe(true);
  expect(f.core.snapshot().attachedToRobot).toBe(false); expect(f.core.activePath()).toHaveLength(2);
});

it("cancels an invalid held preview immediately and consumes the rest of that gesture", () => {
  const f = fixture(); f.core.setSelected(true); f.core.aim(0, f.point());
  f.core.hold(0, f.point(), false); f.core.release(0.1, f.point());
  f.core.hold(0.2, f.point(), false); f.core.hold(0.3, null, false);
  expect(f.core.snapshot().placementStage).toBe("none");
  f.core.hold(0.4, f.point(), false); f.core.release(0.5, f.point());
  expect(f.commands.sendGoal).not.toHaveBeenCalled(); expect(f.core.isAiming()).toBe(false);
  f.core.hold(0.6, f.point(), false); f.core.release(0.7, f.point()); expect(f.core.isAiming()).toBe(true);
});

it("keeps independent probes, one owner, and an unchanged executing goal while drafting", () => {
  const f = liveFixture(); f.core.setSelected(true);
  f.core.aim(2, f.point(4), "left"); f.core.aim(2, f.point(5), "right");
  expect(f.core.snapshot().probes.map(probe => probe.sourceId)).toEqual(["left", "right"]);
  f.core.hold(2.1, f.point(4), false, "left"); f.core.release(2.2, f.point(4), "left");
  f.core.aim(2.3, f.point(6), "left");
  expect(f.core.snapshot().activeGoal.pose?.position).toEqual([2, 0, 0]);
  expect(f.core.activePath()).toHaveLength(2);
  expect(f.core.snapshot().draft?.position).toEqual([6, 0, 0]);
  expect(f.core.hold(2.4, f.point(5), false, "right")).toBe(false);
  f.core.clearAim("right"); expect(f.core.snapshot().draft?.ownerId).toBe("left");
  f.core.hold(3, f.point(6), false, "left"); f.core.release(3.1, f.point(6), "left");
  expect(f.commands.sendGoal).toHaveBeenCalledOnce();
  expect(f.core.snapshot().activeGoal.pose?.position).toEqual([6, 0, 0]);
});

it("does not replay the previous outcome or replacement idle when a new goal is submitted", () => {
  const f = liveFixture();
  f.view.nav = { state: "resolved", outcome: "succeeded" }; f.apply(); f.core.tick(2, 1);
  f.core.setSelected(true);
  f.core.hold(3, f.point(4), false); f.core.release(3.1, f.point(4));
  f.core.hold(3.2, f.point(4), false); f.core.release(3.3, f.point(4));
  f.apply(); expect(f.core.flash()).toBeNull();
  f.view.nav = { state: "idle", outcome: null }; f.apply(); expect(f.core.flash()).toBeNull();
  f.view.nav = { state: "resolved", outcome: "succeeded" }; f.apply();
  expect(f.core.flash()).toBe("succeeded");
});

it("only removes the draft on owner loss and ignores invalid aim inside a consumed gesture", () => {
  const f = liveFixture(); f.core.setSelected(true);
  f.core.hold(1, f.point(4), false, "left"); f.core.release(1.1, f.point(4), "left");
  f.core.clearAim("right"); expect(f.core.ownsDraft("left")).toBe(true);
  f.core.clearAim("left"); expect(f.core.snapshot().draft).toBeNull();
  expect(f.core.snapshot().activeGoal.active).toBe(true); expect(f.commands.sendGoal).not.toHaveBeenCalled();
});

it("ignores a rebroadcast of the previous outcome until the new execution is acknowledged", () => {
  const f = liveFixture();
  f.view.nav = { state: "resolved", outcome: "succeeded" }; f.apply(); f.core.tick(2, 1);
  f.core.setSelected(true);
  f.core.hold(3, f.point(4), false); f.core.release(3.1, f.point(4));
  f.core.hold(3.2, f.point(4), false); f.core.release(3.3, f.point(4));
  f.view.nav = { state: "resolved", outcome: "succeeded" }; f.apply();
  expect(f.core.flash()).toBeNull(); expect(f.core.snapshot().activeGoal.active).toBe(true);
  f.view.nav = { state: "idle", outcome: null }; f.apply();
  f.view.nav = { state: "resolved", outcome: "succeeded" }; f.apply(); expect(f.core.flash()).toBe("succeeded");
});

it("does not revive a retained goal pose from an already-resolved reconnect snapshot", () => {
  const f = fixture();
  f.view.nav = { state: "resolved", outcome: "succeeded" };
  f.view.nav_goal = { type: "nav_goal", ts: 1, pose: [4, 0, 0, 0], path_poses: [[0, 0, 0, 0], [4, 0, 0, 0]] };
  f.core.applyView(f.view, f.origin, { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, 1);
  expect(f.core.snapshot().activeGoal.active).toBe(false); expect(f.core.snapshot().attachedToRobot).toBe(true);
});
