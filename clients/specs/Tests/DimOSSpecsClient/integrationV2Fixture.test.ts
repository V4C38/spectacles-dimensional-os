import { expect, it } from "vitest";
import { IntegrationV2Fixture } from "../integration-tests/IntegrationV2Fixture";

it("preserves native checked-plan identity across unchanged release and authority reacquisition", () => {
  const states: any[] = [];
  const peer = new IntegrationV2Fixture(value => states.push(JSON.parse(JSON.stringify(value))), "native-test", () => 1);
  const pose = { position: [1, 2, 3], orientation: [0, 0, 0, 1] };
  const acquire = (requestId: string) => peer.command({ type: "interaction_request", action: "acquire",
    request_id: requestId, acquisition_id: requestId, source_id: "mouse", kind: "manipulation_planning", group_id: "arm",
    speed_scale: .5, gripper: 1, ...pose });
  acquire("first");
  const revision = peer.canonical()!.revision;
  const lease = { epoch: "native-fixture", lease_id: "native-lease-1" };
  peer.command({ type: "interaction_request", action: "release", request_id: "release", sequence: 1, ...pose, ...lease });
  expect(peer.canonical()!.revision).toBe(revision);
  expect(states.findLast(state => state.type === "interaction_state")).toMatchObject({
    authority: null, targets: [{ revision, phase: "committed" }],
  });
  acquire("second");
  expect(peer.canonical()!.revision).toBe(revision);
  peer.command({ type: "interaction_request", action: "update", request_id: "change", sequence: 1,
    epoch: "native-fixture", lease_id: "native-lease-2", ...pose, gripper: 0 });
  expect(peer.canonical()!.revision).toBe(revision + 1);
});

it("publishes canonical plan metadata and trajectory over the native v2 bulk peer", () => {
  const controls: any[] = [], bulk: any[] = [];
  const peer = new IntegrationV2Fixture(value => controls.push(value), "native-test", () => 1);
  peer.bind({ onTransportText: text => bulk.push(JSON.parse(text)) } as never);
  peer.sendText(JSON.stringify({ type: "bulk_hello_request" }));
  const plan = { plan_id: "checked", group_id: "arm", target_revision: 7, duration: 1,
    joint_names: ["joint"], trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [.3] }] };
  peer.send({ type: "manipulation_state", execution: "idle", plan });
  const control = controls.at(-1);
  expect(control.plan).toBeUndefined();
  expect(control.plan_ref.id).toMatch(/^trajectory-/);
  const parts = bulk.filter(part => part.type === "bulk_record" && part.id === control.plan_ref.id);
  expect(parts[0].data.metadata).toMatchObject({ plan_id: "checked", group_id: "arm", target_revision: 7 });
  expect(parts.flatMap(part => part.data.points ?? [])).toEqual(plan.trajectory);
});

it("cancels only the matching navigation goal without requiring a held lease", () => {
  const controls: any[] = [];
  const peer = new IntegrationV2Fixture(value => controls.push(JSON.parse(JSON.stringify(value))), "native-test", () => 1);
  let cancellations = 0; peer.onNavigationCancel = () => cancellations++;
  const goal = { type: "nav_goal", pose: [1, 2, 0, 0], path_poses: [], ts: 7 };
  peer.setGoal(goal);
  const cancel = (epoch: string, goal_ts: number) => peer.command({ type: "interaction_request", action: "cancel_navigation",
    request_id: `cancel-${epoch}-${goal_ts}`, epoch, goal_ts });
  cancel("old", 7);
  expect(controls.at(-1)).toMatchObject({ type: "interaction_result", status: "stale", code: "epoch_changed" });
  cancel("native-fixture", 6);
  expect(controls.at(-1)).toMatchObject({ status: "stale", code: "goal_changed" });
  expect(cancellations).toBe(0);
  cancel("native-fixture", 7);
  expect(cancellations).toBe(1);
  expect(controls.at(-1)).toMatchObject({ type: "interaction_result", status: "accepted", code: "navigation_cancelled" });
  expect(controls.findLast(row => row.type === "interaction_state")).toMatchObject({ active_goal: null, authority: null, motion_busy: false });
  expect(controls.every(row => row.type !== "estop_request")).toBe(true);
  peer.setGoal({ ...goal, ts: 8 });
  cancel("native-fixture", 7);
  expect(cancellations).toBe(1);
  expect(controls.findLast(row => row.type === "interaction_state").active_goal.ts).toBe(8);
});
