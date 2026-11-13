import { describe, expect, it, vi } from "vitest";
import type { ARModuleSessionState } from "../src/websocket/ARModuleSession";
import { isAgentEnabled, isManualControlEnabled, isSelectionEligible, OperatingModeController } from "../src/presentation/ControlPanelPresentation";
import { alignmentDistance } from "../src/presentation/NotificationCenter";
import { prepareRoutePath } from "../src/presentation/RoutePathGeometry";
import { projectRobotPose, robotFloorOffset, type RobotMarkerApplyInput } from "../src/robot/RobotPresentation";
import { AgentDraftSession } from "../src/agent/AgentDraftSession";
import { LidarDisplayController } from "../src/sensors/LidarDisplay";
import { deriveNavigationPresentation, type NavigationTargetSnapshot } from "../src/navigation/NavigationInteraction";
import { helloAt, stateFrame } from "./support/SessionFixture";

function ready(): ARModuleSessionState {
  const hello = helloAt(0, { agent: { available: true, reason: null } });
  return { connection: "ready", hasTrackingOrigin: true, hello, state: stateFrame(), pose: null,
    nav_goal: null, lidar: null, capabilities: hello.capabilities, nav: null,
    agentMessage: null, agentMessageRevision: 0, lastError: null };
}
const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } as const;

it("shares route preparation in metres without mutating frozen host input", () => {
  const points = Object.freeze([Object.freeze([0, 0, 0] as const), Object.freeze([2, 0, 0] as const)]);
  const options = { floorY: null, goalY: null, startCircle: { center: [0, 0, 0], radius: 0.1 },
    endCircle: { center: [2, 0, 0], radius: 0.2 }, solid: true, widthM: 0.02 } as const;
  const result = prepareRoutePath(points, options);
  expect(result.points[0][0]).toBeCloseTo(0.11);
  expect(result.points.at(-1)![0]).toBeCloseTo(1.79);
  expect(result.lengthM).toBeCloseTo(1.68);
  expect(points).toEqual([[0, 0, 0], [2, 0, 0]]);
  expect(prepareRoutePath([], options)).toEqual({ points: [], lengthM: 0 });
  expect(prepareRoutePath([[0, 0, 0], [0.05, 0, 0]], options).lengthM).toBeGreaterThan(0);
});

it("uses marker heights and preserves empty output for overlapping footprints", () => {
  const result = prepareRoutePath([[0, 9, 0], [2, 9, 0]], { floorY: 8, goalY: 9, widthM: 0.02,
    startCircle: { center: [0, 0.25, 0], radius: 0.1 }, endCircle: { center: [2, 0.5, 0], radius: 0.2 } });
  expect(result.points[0][1]).toBe(0.25);
  expect(result.points.at(-1)![1]).toBe(0.5);
  expect(prepareRoutePath([[0, 0, 0], [0.1, 0, 0]], { floorY: 0, goalY: 0, widthM: 0.02,
    startCircle: { center: [0, 0, 0], radius: 0.2 }, endCircle: { center: [0.1, 0, 0], radius: 0.2 } }))
    .toEqual({ points: [], lengthM: 0 });
});

it("derives alignment distance only with current tracking and supports stationary arm roots", () => {
  const view = { ...ready(), pose: { type: "pose", position: [3, 4, 0], orientation: [0, 0, 0, 1], ts: 0 } } as ARModuleSessionState;
  expect(alignmentDistance(view, origin, [0, 0, 0])).toBe(5);
  expect(alignmentDistance(view, origin, [3, 4, 0])).toBe(0);
  expect(alignmentDistance({ ...view, hasTrackingOrigin: false }, origin, [0, 0, 0])).toBeNull();
  expect(alignmentDistance(view, null, [0, 0, 0])).toBeNull();
  expect(alignmentDistance(view, origin, null)).toBeNull();
  expect(alignmentDistance({ ...view, pose: null, manipulation: { root_pose: view.pose } } as ARModuleSessionState,
    origin, [0, 0, 0])).toBe(5);
});

it("preserves fallback modes and requests authoritative modes without optimistic changes", () => {
  const controller = new OperatingModeController(), view = ready(), request = vi.fn();
  controller.set(view, "agent", request);
  expect(controller.effective(view)).toBe("agent");
  expect(request).not.toHaveBeenCalled();
  const shared = { ...view, interaction: { mode: "manual" } } as ARModuleSessionState;
  controller.set(shared, "agent", request);
  expect(request).toHaveBeenCalledWith("agent");
  expect(controller.effective(shared)).toBe("manual");
  controller.reset(shared);
  expect(controller.effective(view)).toBe("agent");
  controller.reset(view);
  expect(controller.effective(view)).toBe("manual");
  expect(() => controller.set({ ...view, capabilities: helloAt(0).capabilities }, "agent", request))
    .toThrow("hello.capabilities.agent is not available");
});

it("makes browser reset policy explicit and keeps control eligibility independent of retained feedback", () => {
  const controller = new OperatingModeController({ resetFallbackWithSharedState: true }), view = ready();
  controller.set(view, "agent", vi.fn());
  controller.reset({ ...view, interaction: { mode: "manual" } } as ARModuleSessionState);
  expect(controller.effective(view)).toBe("manual");
  expect(isSelectionEligible({ ...view, connection: "disconnected" }, true, false, true)).toBe(true);
  expect(isSelectionEligible(view, true, true, true)).toBe(false);
  expect(isManualControlEnabled(view, true, false)).toBe(true);
  expect(isManualControlEnabled(view, true, false, true)).toBe(false);
  expect(isManualControlEnabled(view, true, false, false, "agent")).toBe(false);
  expect(isManualControlEnabled({ ...view, connection: "disconnected" }, true, false)).toBe(false);
  expect(isAgentEnabled(view, true, "agent")).toBe(true);
  expect(isAgentEnabled(view, false, "agent")).toBe(false);
});

describe("setup LiDAR lifecycle", () => {
  it("waits for explicit setup commands, retries failures, and remembers successful sends", () => {
    let view = ready();
    const sendText = vi.fn().mockImplementationOnce(() => { throw new Error("offline"); });
    const sensors = new LidarDisplayController({ view: () => view, sendText });
    sensors.observe(view); expect(sendText).not.toHaveBeenCalled();
    sensors.syncSetup(false); sensors.syncSetup(false); sensors.syncSetup(false);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sendText.mock.calls[1][0]).enabled).toBe(false);
    sensors.syncSetup(true); sensors.syncSetup(true);
    expect(sendText).toHaveBeenCalledTimes(3);
    expect(JSON.parse(sendText.mock.calls[2][0]).enabled).toBe(true);
    view = { ...view, connection: "disconnected" }; sensors.observe(view);
    view = { ...view, connection: "ready" }; sensors.syncSetup(true);
    expect(sendText).toHaveBeenCalledTimes(3);
    sensors.resetPostSetup(); sensors.syncSetup(true);
    expect(sendText).toHaveBeenCalledTimes(4);
    sensors.resetSetup(); sensors.syncSetup(false);
    expect(sendText).toHaveBeenCalledTimes(5);
  });

  it("resets only the configured host lifecycle across disconnects and never sends without capability", () => {
    let view = ready();
    const sendText = vi.fn();
    const sensors = new LidarDisplayController({ view: () => view, sendText }, undefined, true,
      { resetSetupOnDisconnect: true });
    sensors.syncSetup(true);
    view = { ...view, connection: "disconnected" }; sensors.observe(view); sensors.syncSetup(false);
    view = { ...view, connection: "ready", capabilities: null }; sensors.syncSetup(true);
    expect(sendText).toHaveBeenCalledTimes(1);
    view = ready(); sensors.syncSetup(true);
    expect(sendText).toHaveBeenCalledTimes(2);
  });
});

it("updates agent response revisions once and stops recognition when session eligibility is lost", () => {
  const recognition = { start: vi.fn(), stop: vi.fn() }, synthesis = { speak: vi.fn(), stop: vi.fn() };
  const draft = new AgentDraftSession({ recognition, synthesis, send: vi.fn(), estop: vi.fn(),
    isSelected: () => true, select: vi.fn() });
  const view = { ...ready(), agentMessage: "Ready", agentMessageRevision: 1 };
  draft.tickSession(0, view, true, "agent");
  draft.tickSession(1, view, true, "agent");
  expect(synthesis.speak).toHaveBeenCalledOnce();
  draft.tickSession(2, { ...view, agentMessageRevision: 2 }, true, "agent");
  expect(synthesis.speak).toHaveBeenCalledTimes(2);
  expect(draft.beginRecording()).toBe(true);
  draft.tickSession(3, { ...view, connection: "disconnected" }, true, "agent");
  expect(draft.snapshot().status).toBe("Off");
  expect(draft.isRecording()).toBe(false);
  expect(recognition.stop).toHaveBeenCalled();
});

it("projects navigation visibility while preserving each host's drag-feedback policy", () => {
  const state = { visible: true, dragging: false, position: [1, 2, 0], orientation: [0, 0, 0, 1],
    draft: { position: [2, 3, 0], orientation: [0, 0, 0, 1], held: true },
    activeGoal: { pose: { position: [3, 4, 0], orientation: [0, 0, 0, 1] }, active: false, confirmationId: 7 },
    flash: null, probes: [] } as unknown as NavigationTargetSnapshot;
  expect(deriveNavigationPresentation(state).mainVisible).toBe(false);
  expect(deriveNavigationPresentation(state).draftVisible).toBe(true);
  const dragging = { ...state, dragging: true, flash: "succeeded" as const };
  expect(deriveNavigationPresentation(dragging).mainPose.position).toEqual([1, 2, 0]);
  expect(deriveNavigationPresentation(dragging).flash).toBeNull();
  expect(deriveNavigationPresentation(dragging, { showFlashDuringDrag: true }).flash).toBe("succeeded");
  expect(deriveNavigationPresentation({ ...state, visible: false }).draftVisible).toBe(false);
});


it("shares robot pose projection and rotated floor offsets in the supplied coordinate basis", () => {
  const view = ready();
  const input: Extract<RobotMarkerApplyInput, { mode: "localizedOdom" }> = {
    mode: "localizedOdom", view, origin, robot: view.hello!.robot,
    pose: { type: "pose", ts: 0, position: [3, 4, 0], orientation: [0, 0, 0, 1] },
  };
  expect(projectRobotPose(input).position).toEqual([3, 4, 0]);
  expect(robotFloorOffset([0, 0, 0, 1], 0.3)).toEqual([0, 0, -0.3]);
  expect(robotFloorOffset([0, 0, 0, 1], 0.3, "y")).toEqual([0, -0.3, 0]);
  const half = Math.sqrt(0.5);
  const tilted = robotFloorOffset([0, 0, half, half], 0.3, "y");
  expect(tilted[0]).toBeCloseTo(0.3);
  expect(tilted[1]).toBeCloseTo(0);
  expect(Math.hypot(...tilted)).toBeCloseTo(0.3);
});
