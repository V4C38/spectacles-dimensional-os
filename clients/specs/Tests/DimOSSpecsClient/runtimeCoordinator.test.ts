import { expect, it, vi } from "vitest";
import { SpecsRuntimeCoordinator } from "../../Assets/Scripts/DimOSSpecsClient/SpecsRuntimeCoordinator";
import { setMockTime } from "../setup/lens-globals";

function fixture() {
  setMockTime(1);
  const events: string[] = [];
  const action = (name: string) => vi.fn(() => { events.push(name); });
  let suspended = false;
  const view = { connection: "ready", hasTrackingOrigin: false, capabilities: null };
  const originStore = { T_odom_client: null as object | null };
  const room = action("room");
  const dt = vi.fn(() => 0.5);
  Object.assign(globalThis, { getDeltaTime: dt });
  const deps = {
    suspended: () => suspended,
    syncSelectionEligibility: action("eligibility"), publishPose: action("publish"),
    streamDiagnostics: () => ({}),
    cameraSource: { samplePose: action("sample"), diagnostics: () => ({}), trackingPosition: () => { throw new Error("tracking unavailable"); } },
    session: { tick: action("session"), view: () => view },
    episode: { tick: action("capture"), view: () => ({ phase: "idle" }), captureBudget: () => ({}) },
    clientTrackingOriginStore: originStore,
    activeRouteRenderer: { hide: action("route-hide") }, previewRoute: { hide: action("preview-hide") },
    navigationController: {
      setViewportHeight: vi.fn(), setInputEnabled: vi.fn(), hide: vi.fn(), setSelected: vi.fn(),
      surveyFloor: action("survey"), tick: action("navigation"), circleOpacity: () => 0.35,
      interaction: { snapshot: () => ({ attachedToRobot: true }) },
    },
    robotPresenter: { setViewportHeight: vi.fn(), setSelected: vi.fn(), reset: vi.fn(), setNavigationFloor: vi.fn() },
    uiPresenter: { tick: action("ui"), isSetupCompleted: () => false, applyRoomPresentation: room,
      isAlignmentReviewPending: () => false, getOperatingMode: () => "manual", getDebugMode: () => false },
    cameraObject: { getComponent: () => null, getTransform: () => ({ getWorldPosition: () => vec3.zero() }) },
    selection: { isSelected: () => false }, lidarPresenter: { hide: vi.fn() },
    manipulation: { renderer: { debugEnabled: false }, tick: action("arm") },
    navigationInput: { tick: action("input") },
    annotations: { clearAll: vi.fn(), recompose: vi.fn(), update: action("annotations") },
    notifications: { tick: action("notifications") }, alignmentWarning: { update: vi.fn() },
  };
  const coordinator = new SpecsRuntimeCoordinator(deps as never);
  return { coordinator, deps, events, dt, view, originStore, room, suspend: () => { suspended = true; } };
}

it("pumps each owner once in frame order and clamps presentation time only", () => {
  const f = fixture();
  f.coordinator.tick();
  expect(f.events.slice(0, 7)).toEqual(["sample", "session", "capture", "publish", "eligibility", "ui", "eligibility"]);
  expect(f.events.indexOf("ui")).toBeLessThan(f.events.indexOf("arm"));
  expect(f.events.indexOf("input")).toBeLessThan(f.events.indexOf("navigation"));
  expect(f.events.indexOf("navigation")).toBeLessThan(f.events.indexOf("notifications"));
  expect(f.deps.session.tick).toHaveBeenCalledOnce();
  expect(f.deps.uiPresenter.tick).toHaveBeenCalledWith(0.1);
  expect(f.deps.navigationController.tick).toHaveBeenCalledWith(0.1);
});

it("does no sampling or domain work during suspension", () => {
  const f = fixture(); f.suspend(); f.coordinator.tick();
  expect(f.events).toEqual([]);
  expect(f.dt).not.toHaveBeenCalled();
});

it("refreshes room presentation only after invalidation or origin change", () => {
  const f = fixture();
  f.coordinator.tick(); f.coordinator.tick();
  expect(f.room).toHaveBeenCalledOnce();
  f.coordinator.invalidateRoom(); f.coordinator.tick();
  expect(f.room).toHaveBeenCalledTimes(2);
  f.originStore.T_odom_client = { position: [0, 0, 0], orientation: [0, 0, 0, 1] };
  f.coordinator.tick();
  expect(f.room).toHaveBeenCalledTimes(3);
  expect(f.deps.annotations.recompose).toHaveBeenCalledOnce();
  expect(f.deps.alignmentWarning.update).toHaveBeenLastCalledWith(null, false, "idle", f.deps.notifications);
});
