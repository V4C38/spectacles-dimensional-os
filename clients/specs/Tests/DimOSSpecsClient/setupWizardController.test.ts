import { beforeEach, describe, expect, it, vi } from "vitest";
import { setMockTime } from "../setup/lens-globals";

const mocks = vi.hoisted(() => {
  return { next: () => {}, footer: vi.fn() };
});

vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView", () => ({
  SetupWizardStep: { StartRobot: 0, Connect: 1, Localization: 2 },
  SetupWizardView: class {
    bindHandlers(next: () => void) { mocks.next = next; }
    setStepContent() {}
    applyStepLayout() {}
    setInputEnabled() {}
    setConnectionToggleVisible() {}
    setStatus() {}
    setConnectionToggleLabel() {}
    initializeInput() {}
    applyFooterState(_step: number, state: unknown) { mocks.footer(state); }
  },
}));

import { SetupWizardController, type SetupWizardControllerDeps } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController";

function harness() {
  const view = { connection: "ready", hasTrackingOrigin: false, hello: null };
  const finished = vi.fn();
  const episode = { reset: vi.fn(), pause: vi.fn(), requestStart: vi.fn(), view: () => ({ phase: "capturing" }) };
  const controller = new SetupWizardController({
    panel: { enabled: true, getTransform: () => ({ getLocalScale: () => vec3.one(), setLocalScale: vi.fn() }) },
    script: { createEvent: () => ({ bind: vi.fn(), reset: vi.fn() }) },
    session: { view: () => view },
    episode,
    clientTrackingOriginStore: { clear: vi.fn() },
    onFinished: finished,
  } as unknown as SetupWizardControllerDeps);
  controller.start(false);
  mocks.next();
  setMockTime(1);
  mocks.next();
  return { controller, view, finished, episode };
}

beforeEach(() => {
  setMockTime(0);
  mocks.footer.mockClear();
});

describe("setup localization completion", () => {
  it("auto completes once on the next tick after localization succeeds", () => {
    const { controller, view, finished, episode } = harness();
    view.hasTrackingOrigin = true;
    controller.onSessionViewChanged();
    expect(finished).not.toHaveBeenCalled();
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
