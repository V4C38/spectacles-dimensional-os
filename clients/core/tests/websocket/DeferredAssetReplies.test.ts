import { expect, it, vi } from "vitest";
import { DeferredAssetReplies } from "../../src/websocket/DeferredAssetReplies";
import { BulkTransfer } from "../../src/websocket/BulkTransfer";

function fixture() {
  let now = 0;
  const bulk = new BulkTransfer({ now: () => now }, () => {}, () => {}, () => {});
  const hydrate = vi.spyOn(bulk, "hydrate").mockImplementation(value => ({ value, pending: true, unavailable: false }));
  const retire = vi.fn();
  const apply = vi.fn();
  const replies = new DeferredAssetReplies({ now: () => now }, bulk, apply, retire, vi.fn());
  return { replies, hydrate, retire, apply, advance: (seconds: number) => { now += seconds; } };
}

it("bounds correlations while allowing replacement and reclaiming dropped capacity", () => {
  const { replies } = fixture();
  for (let i = 0; i < 64; i++) replies.defer({ request_id: String(i) }, 10);
  expect(() => replies.defer({ request_id: "overflow" }, 10)).toThrow("budget");
  expect(() => replies.defer({ request_id: "0" }, 20)).not.toThrow();
  expect(replies.deadline("0")).toBe(20);
  replies.drop("1");
  expect(() => replies.defer({ request_id: "new" }, 10)).not.toThrow();
});

it("rebases delayed map poses while preserving native joint trajectory receipts", () => {
  const f = fixture();
  const value = { type: "manipulation_result", request_id: "plan", action: "plan", group_id: "arm",
    status: "planned", plan_id: "native-plan", joint_names: ["joint"], duration: 1,
    trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [.3] }],
    pose: { position: [1, 2, 3], orientation: [0, 0, 0, 1] },
    sample_pose: { position: [2, 3, 4], orientation: [0, 0, 0, 1] } };
  f.replies.defer(value, 10);
  f.replies.discardSpatial({ position: [10, 20, 0], orientation: [0, 0, 0, 1] });
  f.hydrate.mockReturnValue({ value, pending: false, unavailable: false });
  f.replies.tick(0);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.apply.mock.calls[0][0]).toMatchObject({ plan_id: "native-plan", trajectory: value.trajectory,
    pose: { position: [11, 22, 3] }, sample_pose: { position: [12, 23, 4] } });
});

it("late retired-frame native receipts cannot restore their spatial fields during hydration", () => {
  const f = fixture();
  const value = { type: "manipulation_result", request_id: "evaluate", action: "evaluate", group_id: "arm",
    status: "feasible", joints: { joint: .3 },
    pose: { position: [1, 2, 3], orientation: [0, 0, 0, 1] } };
  f.replies.defer(value, 10, true);
  f.hydrate.mockReturnValue({ value, pending: false, unavailable: false });
  f.replies.tick(0);
  expect(f.apply.mock.calls[0][0]).toMatchObject({ status: "feasible", joints: { joint: .3 } });
  expect(f.apply.mock.calls[0][0].pose).toBeUndefined();
});

it("expires pending correlations and frees their capacity", () => {
  const f = fixture();
  for (let i = 0; i < 64; i++) f.replies.defer({ request_id: String(i) }, 1);
  f.advance(1);
  f.replies.tick(1);
  expect(f.retire).toHaveBeenCalledTimes(64);
  expect(() => f.replies.defer({ request_id: "new" }, 10)).not.toThrow();
});

it("rotates pending work fairly across four-attempt passes", () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.replies.defer({ request_id: String(i) }, 10);
  f.replies.tick(0);
  expect(f.hydrate).toHaveBeenCalledTimes(4);
  f.replies.tick(0);
  expect(f.hydrate).toHaveBeenCalledTimes(8);
  f.replies.tick(0);
  expect(new Set(f.hydrate.mock.calls.map(([value]) => value.request_id)).size).toBe(9);
});

it("stops hydration when the processing time budget is consumed", () => {
  const f = fixture();
  f.replies.defer({ request_id: "a" }, 10);
  f.replies.defer({ request_id: "b" }, 10);
  f.hydrate.mockImplementation(value => {
    f.advance(.002);
    return { value, pending: true, unavailable: false };
  });
  f.replies.tick(0);
  expect(f.hydrate).toHaveBeenCalledTimes(1);
  f.replies.tick(.002);
  expect(f.hydrate.mock.calls[1][0].request_id).toBe("b");
});
