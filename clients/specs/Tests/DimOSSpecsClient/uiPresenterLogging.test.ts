import { describe, expect, it, vi } from "vitest";

vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController", () => ({
  SetupWizardController: class {},
}));

import { AppState } from "../../Assets/Scripts/DimOSSpecsClient/presentation/AppState";
import { UIPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/UIPresenter";

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
      appState, setupCompleted: true,
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
