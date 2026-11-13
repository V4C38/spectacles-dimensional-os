// @vitest-environment jsdom
import "./fixtures/xrEnvironment";
import { expect, it } from "vitest";
import { MainMenuView } from "../src/presentation/MainMenuView";
import type { WebXRUISnapshot } from "../src/presentation/WebXRUIPresenter";
import { installMenuQueries } from "./integration-tests/fixtures/MenuQueries";

function fixture() {
  const noop = () => {};
  const menu = new MainMenuView({ onSetup: noop, onBack: noop, onRetry: noop, onRestart: noop,
    onMenu: noop, onMode: noop, onRobot: noop, onDebug: noop, onLocalize: noop, onRealign: noop,
    onEstop: noop, onDraft: noop, onAgentText: () => true });
  const snap: WebXRUISnapshot = {
    setupCompleted: false, menuOpen: true, wizardStep: "connect", robotName: "Go2", robotSelected: true,
    robotSelectable: true, robotConnectionText: "Connected", connectionText: "Connected", connectionTone: "success",
    operatingMode: "manual", debugEnabled: false, agentAvailable: true, lidarAvailable: true, estopAvailable: true,
    estopReason: null, activity: "Idle", hasTrackingOrigin: true, lidarMode: "off", debugText: "Diagnostics",
    wizardTitle: "", wizardDescription: "", wizardCardTitle: "Connected", wizardCardBody: "Ready",
    nextLabel: "Continue", localizationIssue: null, captureText: "", captureTone: "muted", backVisible: false,
    agentMessage: null, hudText: null, hudTone: null, connectComplete: true,
  };
  installMenuQueries();
  const query = (window as any).integrationMenuQueries;
  menu.apply(snap); menu.updateHover([], 0.3);
  return { menu, snap, query };
}

it("resolves actual visible setup buttons without private menu fields or callbacks", () => {
  const { menu, query } = fixture();
  try {
    const next = query.button(menu, "Continue");
    expect(menu.ownsTarget(next.mesh)).toBe(true);
    expect(query.button(menu, "Reconnect").text).toBe("Reconnect");
    expect(() => query.button(menu, "Send to agent")).toThrow("Missing visible menu button");
  } finally { menu.dispose(); }
});

it("finds rendered agent response through the public scroll-view target mapping", () => {
  const { menu, snap, query } = fixture();
  try {
    const response = "The robot reached the requested location.";
    menu.apply({ ...snap, setupCompleted: true, operatingMode: "agent" }, {
      status: "Ready", prompt: "", response, severity: "ok", error: null, recognitionAvailable: true,
    });
    menu.updateHover([], 0.3);
    const view = query.response(menu, response);
    expect(view?.text).toBe(response);
    expect(menu.scrollView(view.bodyHit)).toBe(view);
    expect(query.response(menu, "absent text")).toBeUndefined();
  } finally { menu.dispose(); }
});

it("waits for rendered size and page fades to settle", () => {
  const { menu, snap, query } = fixture();
  try {
    expect(query.settled(menu)).toBe(false);
    expect(query.settled(menu)).toBe(true);
    menu.apply({ ...snap, setupCompleted: true, operatingMode: "agent" });
    menu.updateHover([], 0.04);
    expect(query.settled(menu)).toBe(false);
    menu.updateHover([], 0.3);
    expect(query.settled(menu)).toBe(false);
    expect(query.settled(menu)).toBe(true);
  } finally { menu.dispose(); }
});
