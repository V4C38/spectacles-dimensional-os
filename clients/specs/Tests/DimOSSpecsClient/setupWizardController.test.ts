import { beforeEach, describe, expect, it, vi } from "vitest";
import { setMockTime } from "../setup/lens-globals";

const mocks = vi.hoisted(() => {
  return { next: () => {}, previous: () => {}, footer: vi.fn(), connection: vi.fn(), captureLayout: vi.fn(), submit: () => {}, input: "" };
});

vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView", () => ({
  SetupWizardStep: { Connect: 1, Localization: 2 },
  SetupWizardView: class {
    bindHandlers(next: () => void, previous: () => void, submit: () => void) { mocks.next = next; mocks.previous = previous; mocks.submit = submit; }
    getInputText() { return mocks.input; }
    setStepContent() {}
    applyStepLayout() {}
    setInputEnabled() {}
    setConnectionToggleVisible() {}
    setStatus() {}
    setCaptureLayout(value: boolean) { mocks.captureLayout(value); }
    setConnectionState(state: unknown) { mocks.connection(state); }
    setConnectionToggleLabel() {}
    initializeInput() {}
    applyFooterState(_step: number, state: unknown) { mocks.footer(state); }
  },
}));

import { SetupWizardController, type SetupWizardControllerDeps } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController";

function harness() {
  const view = { connection: "ready", hasTrackingOrigin: false, hello: null };
  const finished = vi.fn();
  const dismissed = vi.fn();
  const episode = { reset: vi.fn(), pause: vi.fn(), requestStart: vi.fn(), view: () => ({ phase: "capturing" }) };
  const controller = new SetupWizardController({
    panel: { enabled: true, getComponent: () => null, getTransform: () => ({ getLocalScale: () => vec3.one(), setLocalScale: vi.fn() }) },
    script: { createEvent: () => ({ bind: vi.fn(), reset: vi.fn(), cancel: vi.fn() }) },
    session: { view: () => view },
    episode,
    ipRelayClient: { resolve: () => new Promise(() => {}) },
    clientTrackingOriginStore: { clear: vi.fn() },
    onFinished: finished,
    onDismissToRuntime: dismissed,
  } as unknown as SetupWizardControllerDeps);
  controller.start(false);
  episode.pause.mockClear();
  mocks.next();
  setMockTime(1);
  return { controller, view, finished, dismissed, episode };
}

beforeEach(() => {
  setMockTime(0);
  mocks.footer.mockClear();
});

describe("setup localization completion", () => {
  it("shows success for 1.5 seconds, then completes once", () => {
    const { controller, view, finished, episode } = harness();
    view.hasTrackingOrigin = true;
    controller.onSessionViewChanged();
    expect(finished).not.toHaveBeenCalled();
    controller.tick();
    expect(finished).not.toHaveBeenCalled();
    setMockTime(2.5);
    controller.tick();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(episode.pause).not.toHaveBeenCalled();
    expect(controller.isVisible()).toBe(false);
    controller.tick();
    controller.onSessionViewChanged();
    setMockTime(2);
    mocks.next();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("keeps Skip available during capture and pauses when it is pressed", () => {
    const { controller, finished, episode } = harness();
    controller.tick();
    expect(finished).not.toHaveBeenCalled();
    expect(mocks.footer).toHaveBeenLastCalledWith(expect.objectContaining({ footerNextLabel: "Skip", footerNextEnabled: true }));
    setMockTime(2);
    mocks.next();
    expect(episode.pause).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("does not complete from a stale origin after disconnect", () => {
    const { controller, view, finished } = harness();
    view.hasTrackingOrigin = true;
    view.connection = "disconnected";
    controller.tick();
    expect(finished).not.toHaveBeenCalled();
  });
});

it("restarts the connection step and clears stale alignment review", () => {
  const { controller, episode } = harness();
  controller.flow.requestAlignmentReview("Tracking resumed");
  controller.start(true);
  expect(controller.flow.completed).toBe(false);
  expect(controller.flow.step).toBe("connect");
  expect(controller.flow.alignmentReview).toBeNull();
  expect(controller.isVisible()).toBe(true);
  expect(episode.pause).toHaveBeenCalled();
});

it("allows immediate Back from runtime setup before Connect completes", () => {
  const { controller, view, dismissed } = harness();
  view.connection = "disconnected";
  controller.start(true);
  expect(mocks.footer).toHaveBeenLastCalledWith(expect.objectContaining({ footerShowPrev: true }));
  mocks.previous();
  expect(controller.isVisible()).toBe(false);
  expect(controller.flow.completed).toBe(true);
  expect(dismissed).toHaveBeenCalledOnce();
});

it("allows Back from alignment after a completed connection is lost", () => {
  const { controller, view } = harness();
  controller.onSessionViewChanged();
  // The completed Connect step stays reachable when alignment loses its link.
  view.connection = "disconnected";
  controller.onSessionViewChanged();
  mocks.previous();
  expect(controller.flow.step).toBe("connect");
  expect(controller.isVisible()).toBe(true);
});

it("shows a yellow prompt on restart without a duplicate waiting message", () => {
  const { controller, view } = harness();
  view.connection = "disconnected";
  controller.start(true);
  expect(mocks.connection).toHaveBeenLastCalledWith(expect.objectContaining({
    text: "Enter a 6-digit PIN", phase: "entry", details: undefined,
  }));
  const state = mocks.connection.mock.calls.at(-1)![0];
  expect(state.color.x).toBe(1);
  expect(state.color.y).toBeGreaterThan(0.5);
});

it("uses the same status line for validation errors and PIN resolution", () => {
  const { controller, view } = harness();
  view.connection = "disconnected";
  controller.start(true);
  mocks.input = "12";
  mocks.submit();
  let state = mocks.connection.mock.calls.at(-1)![0];
  expect(state.phase).toBe("error");
  expect(state.color.y).toBeLessThan(0.5);
  mocks.input = "123456";
  mocks.submit();
  controller.onSessionViewChanged();
  state = mocks.connection.mock.calls.at(-1)![0];
  expect(state.text).toBe("Resolving PIN…");
  expect(state.phase).toBe("entry");
  expect(state.color.y).toBeGreaterThan(0.5);
});

it("does not let a cancelled connection poll replace localization content", () => {
  const { controller } = harness();
  mocks.connection.mockClear();
  (controller as any).onPollFired();
  (controller as any).showConnectStatus();
  expect(mocks.connection).not.toHaveBeenCalled();
  expect(controller.flow.step).toBe("localization");
});

it("keeps the success height stable when session packets arrive during celebration", () => {
  const { controller, view } = harness();
  view.hasTrackingOrigin = true;
  controller.tick();
  mocks.captureLayout.mockClear();
  controller.onSessionViewChanged();
  controller.onSessionViewChanged();
  expect(mocks.captureLayout).not.toHaveBeenCalled();
});

it("restores the runtime localization baseline when Back aborts re-setup", () => {
  const { controller, view } = harness();
  const origin = { position: [1, 2, 3], orientation: [0, 0, 0, 1], confidence: 1, ts: 1 };
  const restore = vi.fn();
  (view as any).hello = { odom_reference_id: "same-odom", robot: { display_name: "Robot" } };
  (controller as any).deps.clientTrackingOriginStore = { T_odom_client: origin, clear: vi.fn(), restore };
  controller.start(true);
  mocks.previous();
  expect(restore).toHaveBeenCalledWith(origin);
});

it.each(["pause", "new-reference"])("does not restore a baseline after %s", reason => {
  const { controller, view } = harness();
  const restore = vi.fn();
  (view as any).hello = { odom_reference_id: "old-odom", robot: { display_name: "Robot" } };
  (controller as any).deps.clientTrackingOriginStore = {
    T_odom_client: { position: [1, 2, 3], orientation: [0, 0, 0, 1], confidence: 1, ts: 1 }, clear: vi.fn(), restore,
  };
  controller.start(true);
  if (reason === "pause") controller.invalidateBaseline();
  else { (view as any).hello = { odom_reference_id: "new-odom", robot: { display_name: "Robot" } }; controller.onSessionViewChanged(); }
  mocks.previous();
  expect(restore).not.toHaveBeenCalled();
});
