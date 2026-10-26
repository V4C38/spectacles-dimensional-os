import { describe, expect, it, vi } from "vitest";

vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController", () => ({
  SetupWizardController: class {},
}));

vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/MainMenuView", () => ({ MainMenuView: class {} }));

import { AppState } from "../../Assets/Scripts/DimOSSpecsClient/presentation/AppState";
import { UIPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/UIPresenter";
import { scaleIn, scaleOut } from "../../Assets/Scripts/DimOSSpecsClient/utilities/AnimationUtilities";
import { flushAnimations } from "../mocks/animate";

describe("HUD logging", () => {
  it("keeps debug pose updates out of the console", () => {
    const presenter = new UIPresenter();
    const appState = new AppState();
    appState.debugModeEnabled = true;
    const view = {
      connection: "ready", hasTrackingOrigin: true,
      hello: { robot: { display_name: "Unitree Go2" } },
      capabilities: null,
      pose: { position: [1, 2, 3], orientation: [0, 0, 0, 1] },
    };
    const logConsole = vi.fn();
    const refreshLabels = vi.fn();
    Object.assign(presenter, {
      appState, setupFlow: { completed: true },
      uiLogger: { tick: vi.fn(), logConsole },
      deps: {
        session: { view: () => view },
        clientTrackingOriginStore: {
          T_odom_client: {
            position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0,
          },
        },
        robotPresenter: { refreshLabels },
      },
      sendPostWizardLidarDefault: vi.fn(),
      refreshLocalizationCaptureStatus: vi.fn(),
    });
    for (let i = 0; i < 5; i++) {
      view.pose.position = [i, 2, 3];
      presenter.tick(1 / 60);
    }
    expect(logConsole).not.toHaveBeenCalled();
    expect(refreshLabels).toHaveBeenCalledTimes(5);
  });
});

it("keeps the runtime palm menu suppressed while setup is open", () => {
  const presenter = new UIPresenter();
  const flow = { completed: false }, palmTick = vi.fn();
  Object.assign(presenter, {
    setupFlow: flow, setupWizardController: { tick: vi.fn() },
    wristMenuController: { tick: palmTick }, uiLogger: { tick: vi.fn() },
    deps: { speechController: null }, ensureWizardLidarOff: vi.fn(),
    refreshHud: vi.fn(), refreshRobotLabels: vi.fn(), refreshLocalizationCaptureStatus: vi.fn(),
    snapshot: () => ({}), mainMenuView: { apply: vi.fn(), tick: vi.fn() },
  });
  // A held palm must not reopen the old Settings panel over a restarted wizard.
  for (let i = 0; i < 60; i++) presenter.tick(1 / 60);
  expect(palmTick).not.toHaveBeenCalled();
  flow.completed = true;
  presenter.tick(1 / 60);
  expect(palmTick).toHaveBeenCalledOnce();
});

it("restarts on the next tick without stale scale animations reopening or hiding panels", () => {
  flushAnimations();
  const panel = () => {
    let scale = vec3.one();
    return { enabled: true, getTransform: () => ({
      getLocalScale: () => scale, setLocalScale: (value: vec3) => { scale = value; },
    }) } as unknown as SceneObject;
  };
  const main = panel(), setup = panel(), presenter = new UIPresenter();
  const order: string[] = [], stop = vi.fn(() => order.push("stop"));
  const start = vi.fn(() => {
    expect(main.enabled).toBe(false);
    setup.enabled = true;
    setup.getTransform().setLocalScale(new vec3(0.432, 0.432, 0.432));
    order.push("start");
  });
  const setupTick = vi.fn(), palmTick = vi.fn(), menuTick = vi.fn(), setVisible = vi.fn();
  Object.assign(presenter, {
    mainUIFrame: main, setupWizardPanel: setup, setupFlow: { completed: true },
    setupWizardController: { start, tick: setupTick },
    wristMenuController: { closeImmediate: vi.fn(), tick: palmTick },
    mainMenuView: { setVisible, setOperatingMode: vi.fn(), tick: menuTick },
    uiLogger: { tick: vi.fn() }, ensureWizardLidarOff: vi.fn(), refreshHud: vi.fn(),
    deps: { session: { stop }, speechController: { reset: vi.fn(), tick: vi.fn() },
      onModeChanged: vi.fn(), clientTrackingOriginStore: { clear: vi.fn() },
      robotPresenter: { reset: vi.fn() }, episode: { reset: vi.fn() } },
  });
  scaleIn(main, 0.25, new vec3(0.3456, 0.3456, 0.3456));
  scaleOut(setup, 0.2);
  (presenter as any).restartSetup();
  (presenter as any).restartSetup();
  expect(stop).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(presenter.isSetupCompleted()).toBe(true);

  presenter.tick(0.016);
  flushAnimations();
  expect(start).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledWith(true);
  expect(order).toEqual(["start"]);
  expect(stop).not.toHaveBeenCalled();
  expect(presenter.isSetupCompleted()).toBe(false);
  expect(main.enabled).toBe(false);
  expect(main.getTransform().getLocalScale()).toEqual(vec3.zero());
  expect(setup.enabled).toBe(true);
  expect(setup.getTransform().getLocalScale()).toEqual(new vec3(0.432, 0.432, 0.432));
  expect(setVisible).toHaveBeenCalledWith(false);
  expect(setupTick).toHaveBeenCalledWith(0.016);
  expect(palmTick).not.toHaveBeenCalled();
  expect(menuTick).not.toHaveBeenCalled();
});

it.each([false, true])("returns to the main page when setup finishes with alignment=%s", hasTrackingOrigin => {
  const presenter = new UIPresenter();
  const showPage = vi.fn();
  Object.assign(presenter, {
    setupFlow: { completed: false }, isEditorMode: false,
    mainMenuView: { showPage },
    deps: { session: { view: () => ({ hasTrackingOrigin }) } },
    applyRoomPresentation: vi.fn(), sendPostWizardLidarDefault: vi.fn(),
    requestStateIfReady: vi.fn(), refreshHud: vi.fn(),
  });
  (presenter as any).finishWizard();
  expect(presenter.isSetupCompleted()).toBe(true);
  expect(showPage).toHaveBeenCalledWith("main");
});
