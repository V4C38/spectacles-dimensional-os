import { expect, it } from "vitest";
import { ManipulationRequests, type ManipulationRequest } from "../../src/manipulation/ManipulationRequests";
import type { ManipulationResult } from "../../src/manipulation/ManipulationTypes";

function fixture() {
  let now = 0;
  let transferDeadline: number | null = null;
  const owner = new ManipulationRequests(() => now, () => transferDeadline);
  const request = (action: ManipulationRequest["action"]) => ({ action, order: 1,
    generation: 3, episode: 4, epoch: "epoch", lease: "lease", group: "arm", pose: null,
    speed: .5, gripper: null });
  const result = (id: string, action: ManipulationRequest["action"], status = "feasible", group = "arm") => ({
    type: "manipulation_result", request_id: id, action, status, group_id: group,
  }) as ManipulationResult;
  return { owner, request, result, at: (value: number) => { now = value; },
    transfer: (value: number | null) => { transferDeadline = value; } };
}

it("correlates ID, action and group once while preserving the caller's authority and generation context", () => {
  const f = fixture(); f.owner.track("check", f.request("evaluate")); f.at(.25);
  expect(f.owner.take(f.result("check", "plan"))).toBeNull();
  expect(f.owner.take(f.result("check", "evaluate", "feasible", "other"))).toBeNull();
  expect(f.owner.has("evaluate")).toBe(true);
  expect(f.owner.diagnostics()).toMatchObject({ requests: 1, pendingAgeS: .25 });
  expect(f.owner.take(f.result("check", "evaluate"))).toMatchObject({ generation: 3, episode: 4,
    epoch: "epoch", lease: "lease", startedAt: 0, deadline: 5 });
  expect(f.owner.take(f.result("check", "evaluate"))).toBeNull();
  expect(f.owner.diagnostics()).toEqual({ requests: 1, completions: 1, failures: 0,
    timeouts: 0, maximumDurationS: .25, pendingAgeS: 0 });
});

it("extends RPC deadlines during bulk transfer and expires every request only once", () => {
  const f = fixture();
  f.owner.track("check", f.request("evaluate")); f.owner.track("plan", f.request("plan"));
  f.owner.track("reset", f.request("reset_joints"));
  f.transfer(12); f.at(6); expect(f.owner.expired()).toEqual([]);
  f.at(12); expect(f.owner.expired().map(row => row.action)).toEqual(["evaluate"]);
  f.at(20); expect(f.owner.expired().map(row => row.action)).toEqual(["plan"]);
  f.at(65); expect(f.owner.expired().map(row => row.action)).toEqual(["reset_joints"]);
  expect(f.owner.expired()).toEqual([]);
  expect(f.owner.diagnostics()).toMatchObject({ requests: 1, completions: 0, timeouts: 1, maximumDurationS: 12 });
});

it("retires acquisition replies during feedback loss while retaining release correlation", () => {
  const f = fixture();
  f.owner.track("acquire", f.request("acquire")); f.owner.track("release", f.request("release"));
  f.owner.track("plan", f.request("plan")); f.owner.retainRelease();
  expect(f.owner.has("acquire", "plan")).toBe(false); expect(f.owner.has("release")).toBe(true);
  expect(f.owner.take(f.result("acquire", "acquire", "acquired"))).toBeNull();
  expect(f.owner.has("acquire")).toBe(false);
  expect(f.owner.take(f.result("release", "release", "released"))).not.toBeNull();
  f.owner.track("late", f.request("acquire")); f.at(5); f.owner.expired();
  expect(f.owner.take(f.result("late", "acquire", "acquired"))).toBeNull();
  f.owner.track("clear", f.request("acquire")); f.owner.retireAcquisitions(); f.owner.clear();
  expect(f.owner.has("acquire")).toBe(false);
});
