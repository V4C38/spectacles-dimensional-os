import { describe, it, expect, vi, beforeEach } from "vitest";
import { Signal } from "../../Assets/Scripts/App/Utilities/Utilities";
import { InboundRouter } from "../../Assets/Scripts/ARBridge/Session/InboundRouter";
import { AppStateStore } from "../../Assets/Scripts/App/AppState";
import { StatusClient } from "../../Assets/Scripts/ARBridge/Status/StatusClient";
import { TelemetryClient } from "../../Assets/Scripts/ARBridge/Telemetry/TelemetryClient";
import { NavigationClient } from "../../Assets/Scripts/ARBridge/Navigation/NavigationClient";

function makeRouter(phase: "registration" | "runtime") {
  const reconnectEvent = {
    bind: vi.fn(),
    reset: vi.fn(),
  };
  const session = {
    baseUrl: "192.168.1.62",
    createEvent: vi.fn(() => reconnectEvent),
    onConnectionChanged: new Signal<boolean>(),
    isConnected: vi.fn(() => false),
    tryConnect: vi.fn(async () => false),
    disconnect: vi.fn(),
    lastBridgeStatus: null,
  };

  const appState = new AppStateStore();
  appState.update({ phase });

  const robotPresenter = {
    onDisconnect: vi.fn(),
    applyPendingPose: vi.fn(),
    tickFrame: vi.fn(),
    manualRegistrationAlignment: {
      onBridgeStatus: vi.fn(() => false),
      reset: vi.fn(),
    },
  };

  const navigationPlacement = {
    applyPath: vi.fn(),
    applyNavStatus: vi.fn(),
    resyncPreviewGoal: vi.fn(),
    onDisconnect: vi.fn(),
    onHelloReset: vi.fn(),
    handleProtocolError: vi.fn(),
    resetForUserDisconnect: vi.fn(),
  };

  const statusClient = new StatusClient(null, null, null);
  const telemetryClient = new TelemetryClient(appState, null, null, null);
  const navigationClient = new NavigationClient(null, null);

  const router = new InboundRouter(
    session as never,
    appState,
    statusClient,
    telemetryClient,
    navigationClient,
    navigationPlacement as never,
    robotPresenter as never,
    null,
    null,
  );
  router.bind();

  return { router, session, reconnectEvent };
}

describe("InboundRouter runtime reconnect", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).print = vi.fn();
    (globalThis as Record<string, unknown>).getTime = vi.fn(() => 0);
  });

  it("does not schedule reconnect during registration phase", () => {
    const { session, reconnectEvent } = makeRouter("registration");
    session.onConnectionChanged.emit(false);
    expect(reconnectEvent.reset).not.toHaveBeenCalled();
    expect(session.tryConnect).not.toHaveBeenCalled();
  });

  it("schedules reconnect after disconnect in runtime phase", () => {
    const { session, reconnectEvent } = makeRouter("runtime");
    session.onConnectionChanged.emit(false);
    expect(reconnectEvent.reset).toHaveBeenCalledWith(1.0);
  });
});
