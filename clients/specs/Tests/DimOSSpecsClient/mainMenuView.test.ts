import { expect, it, vi } from "vitest";
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow", () => ({ ScrollWindow: class {} }));
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({ Slider: class {} }));
vi.mock("../mocks/UIKit.ts", () => ({ COLOR_WHITE: {}, setButtonSelected: vi.fn(), SnapOS2Styles: {} }));
import { MainMenuView } from "../../Assets/Scripts/DimOSSpecsClient/presentation/MainMenuView";

function fixture() {
  const setState = vi.fn(), text = () => ({ text: "", textFill: {} });
  const field = () => ({ setText: vi.fn(), text: text(), window: { interactable: {} }, dispose: vi.fn() });
  const view = Object.assign(Object.create(MainMenuView.prototype), {
    disposed: false, page: "main", showPage: vi.fn(), robot: { labelText: text(), button: {} }, status: text(),
    modeButtons: [{}, {}], setOperatingMode: vi.fn(), manual: {}, chat: {}, reply: field(), draft: field(), send: {}, clear: {},
    lidarButtons: [{}, {}, {}], sensorControls: [], rangeLabel: text(), range: text(), points: text(), sensorStatus: text(),
    realign: { labelText: text() }, setDebugModeToggle: vi.fn(), diagnostics: field(),
    stop: { visual: { setState } }, stopNativeState: "hovered", stopLatched: false,
  }) as MainMenuView;
  const snapshot: any = { robotName: "Go2", robotConnectionText: "Connected", robotSelected: false, activity: "Idle",
    robotSelectable: false, operatingMode: "manual", agentAvailable: true, speech: null, lidarAvailable: true, lidarMode: "off",
    lidarPreferences: { pointLimit: 1500, obstacleRangeM: 0.6, fullRangeM: 5 }, lidarReceived: 0, cameraStatus: "", trackingStatus: "", surfaceCount: "",
    debugEnabled: false, debugText: "", hasTrackingOrigin: true, estopAvailable: true, estopPressed: true, alignmentReview: false };
  return { view, setState, snapshot };
}

it("applies the stop latch as a visual state and restores native hover without another press", () => {
  const h = fixture(); h.view.apply(h.snapshot); h.view.apply(h.snapshot);
  expect(h.setState.mock.calls).toEqual([["triggered"], ["triggered"]]);
  h.snapshot.estopPressed = false; h.view.apply(h.snapshot);
  expect(h.setState).toHaveBeenLastCalledWith("hovered");
  h.view.apply(h.snapshot); expect(h.setState).toHaveBeenCalledTimes(3);
  expect((h.view as any).robot.button.inactive).toBe(true);
});

it("disposes native registrations and generated fields once, ignoring later snapshots", () => {
  const h = fixture(), unsubscribe = vi.fn(), destroy = vi.fn(), dispose = vi.fn();
  Object.assign(h.view, { subscriptions: [unsubscribe], root: { destroy }, heightController: { dispose } });
  h.view.dispose(); h.view.dispose(); h.view.apply(h.snapshot);
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce();
  expect(h.setState).not.toHaveBeenCalled();
});
