import { describe, expect, it } from "vitest";
import { ArmPathPresentation, ManipulationFramePresenter, type ArmPathInput } from "../../src/manipulation/ArmPresentation";
import { ManipulationPreviewPlayback, type ManipulationSnapshot } from "../../src/manipulation/ManipulationPresentation";
import type { ManipulationModel, ManipulationPlan, ManipulationState } from "../../src/manipulation/ManipulationTypes";

const origin = { position: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const, confidence: 1, ts: 0 };
const model: ManipulationModel = { revision: "one", root: "base", asset_url: null, gripper_joints: {},
  links: [{ name: "base", bounds: null }, { name: "tool", bounds: null }],
  joints: [{ name: "slide", kind: "prismatic", parent: "base", child: "tool", origin,
    axis: [1, 0, 0], mimic: null }] };
const group = { id: "arm", joint_names: ["slide"], base_frame: "base", tip_frame: "tool", has_gripper: false, following: false };
const plan: ManipulationPlan = { plan_id: "checked", duration: 1, joint_names: ["slide"],
  trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [1] }] };
const state: ManipulationState = { type: "manipulation_state", available: true, model, groups: [group],
  observations: { arm: { joints: { slide: 0 }, measured_at: 0, pose: origin, gripper: null } } };
const intent: ManipulationSnapshot = { targetOffset: true, hasDraft: true, dragging: false,
  planning: false, executing: false, resetting: false, stopped: false, fresh: true, activity: "Ready",
  canPreview: true, canExecute: true, canReset: true, canManipulate: true, canStop: true, canResume: false };
const target = { position: [1, 0, 0] as const, orientation: [0, 0, 0, 1] as const };
function pathInput(): ArmPathInput {
  return { model, plan, group, root: origin, observedValues: { slide: 0 }, observedJoints: { slide: .5 },
    fresh: true, executing: true, displaced: true, playing: false, target, observedPose: origin,
    operationId: "operation-one" };
}

describe("shared arm path presentation", () => {
  it("tracks raw feedback monotonically in metres and retains progress across stale feedback", () => {
    const presentation = new ArmPathPresentation();
    const input = pathInput();
    const half = presentation.sample(input);
    expect(half.visible).toBe(true);
    expect(half.points[half.points.length - 1][0]).toBeCloseTo(1);
    expect(half.startDistanceM).toBeCloseTo(.5);
    const stale = presentation.sample({ ...input, fresh: false, observedJoints: { slide: .9 } });
    expect(stale.startDistanceM).toBeCloseTo(.5);
    expect(stale.revision).toBe(half.revision);
    const reversed = presentation.sample({ ...input, observedJoints: { slide: .2 } });
    expect(reversed.startDistanceM).toBeCloseTo(.5);
    const nextOperation = presentation.sample({ ...input, operationId: "operation-two", observedJoints: { slide: .2 } });
    expect(nextOperation.startDistanceM).toBeCloseTo(.2);
  });
  it("retires consumed distance on a new operation before fresh feedback arrives", () => {
    const presentation = new ArmPathPresentation(), input = pathInput();
    expect(presentation.sample(input).startDistanceM).toBeCloseTo(.5);
    const pending = presentation.sample({ ...input, operationId: "operation-two", fresh: false });
    expect(pending.startDistanceM).toBe(0);
    const fresh = presentation.sample({ ...input, operationId: "operation-two", observedJoints: { slide: .2 } });
    expect(fresh.startDistanceM).toBeCloseTo(.2);
  });
  it("rebuilds odom geometry for changed model/root and resets consumption when execution ends", () => {
    const presentation = new ArmPathPresentation(), input = pathInput();
    const initial = presentation.sample(input);
    const shifted = presentation.sample({ ...input, root: { ...origin, position: [10, 0, 0] } });
    expect(shifted.revision).toBeGreaterThan(initial.revision);
    expect(shifted.points[0][0]).toBe(10);
    const idle = presentation.sample({ ...input, executing: false, displaced: false });
    expect(idle.visible).toBe(false);
    expect(idle.startDistanceM).toBe(0);
    const nextModel = presentation.sample({ ...input, model: { ...model, revision: "two" } });
    expect(nextModel.revision).toBeGreaterThan(idle.revision);
  });
  it("uses the exact measured-to-target line without a plan and clears it when the target retires", () => {
    const presentation = new ArmPathPresentation();
    const input = { ...pathInput(), plan: null, executing: false };
    expect(presentation.sample(input).points).toEqual([[0, 0, 0], [1, 0, 0]]);
    expect(presentation.sample({ ...input, target: null }).visible).toBe(false);
    presentation.reset();
    expect(presentation.sample({ ...input, displaced: false }).points).toEqual([]);
  });
});

describe("shared arm frame orchestration", () => {
  const input = { model, state, groupId: "arm", origin, now: 0, selected: true, intent, target,
    solution: { slide: .5 }, plan, desiredGripper: null, rejection: null };
  it("uses one active plan, endpoint/status and context while keeping raw observations unchanged", () => {
    const presentation = new ManipulationFramePresenter();
    const frame = presentation.sample(input);
    expect(frame.activePlan).toBe(plan);
    expect(frame.endEffectorPose).toBe(target);
    expect(frame.proposed.tool.position[0]).toBe(1);
    expect(frame.measured.tool.position[0]).toBe(0);
    expect(frame.status).toEqual({ blocked: false, fresh: true, stopped: false, moving: false, rejection: null });
    expect(frame.displaced).toBe(true);
    expect(state.observations?.arm.joints).toEqual({ slide: 0 });
    const next = presentation.sample({ ...input, origin: { ...origin, ts: 1 }, now: .1 });
    expect(next.contextChanged).toBe(false);
    expect(next.path.revision).toBe(frame.path.revision);
    expect(presentation.sample({ ...input, origin: { ...origin, position: [1, 0, 0] }, now: .2 }).contextChanged).toBe(true);
  });
  it("preserves checked finger joints until an explicit selected gripper edit overrides them", () => {
    const withGripper: ManipulationModel = { ...model, gripper_joints: { grip: { closed: 0, open: 1 } },
      links: [...model.links, { name: "finger", bounds: null }],
      joints: [...model.joints, { name: "grip", kind: "prismatic", parent: "tool", child: "finger",
        axis: [0, 1, 0], origin, mimic: null, limits: { lower: 0, upper: 1 } }] };
    const measured: ManipulationState = { ...state, model: withGripper,
      groups: [{ ...group, has_gripper: true }],
      observations: { arm: { joints: { slide: 0, grip: .2 }, measured_at: 0, pose: origin, gripper: .9 } } };
    const observedInput = { ...input, model: withGripper, state: measured, plan: null, solution: { slide: 0, grip: .2 },
      intent: { ...intent, targetOffset: false } };
    expect(new ManipulationFramePresenter().sample(observedInput).proposed.finger.position[1]).toBeCloseTo(.2);
    expect(new ManipulationFramePresenter().sample({ ...observedInput, desiredGripper: .6 }).proposed.finger.position[1]).toBeCloseTo(.6);
    expect(new ManipulationFramePresenter().sample({ ...observedInput, selected: false }).proposed.finger.position[1]).toBeCloseTo(.9);
  });
  it("shares the injected playback owner, holds time during feedback retention and retires preview on drag", () => {
    const playback = new ManipulationPreviewPlayback();
    const presentation = new ManipulationFramePresenter(playback);
    presentation.sample(input);
    playback.togglePreview();
    expect(presentation.sample({ ...input, now: .1 }).playback.playing).toBe(true);
    const before = presentation.sample({ ...input, now: .3 });
    presentation.hold(2.3);
    expect(presentation.sample({ ...input, now: 2.3 }).playback.time).toBeCloseTo(before.playback.time);
    expect(presentation.sample({ ...input, now: 2.4, intent: { ...intent, dragging: true } }).playback.playing).toBe(false);
    expect(playback.previewRequested).toBe(false);
  });
  it("uses server execution plans and suppresses draft targets/preview in recorded playback", () => {
    const presentation = new ManipulationFramePresenter();
    const serverPlan = { ...plan, plan_id: "executing" };
    const executing = presentation.sample({ ...input, state: { ...state, plan: serverPlan }, intent: { ...intent, executing: true } });
    expect(executing.activePlan).toBe(serverPlan);
    expect(executing.status.moving).toBe(true);
    const recorded = new ManipulationFramePresenter().sample({ ...input, state: { ...state, read_only: true } });
    expect(recorded.activePlan).toBeNull();
    expect(recorded.targetVisible).toBe(false);
    expect(recorded.displaced).toBe(false);
    expect(recorded.endEffectorPose).toBe(origin);
    expect(recorded.proposed.tool.position[0]).toBe(0);
    presentation.reset();
    expect(presentation.preview.previewRequested).toBe(false);
  });
});
