import { describe, it, expect, vi, beforeEach } from "vitest";
import { Signal } from "../../Assets/Scripts/Core/Utilities";
import { BridgeRuntime } from "../../Assets/Scripts/Bridge/BridgeRuntime";
import { DimosState } from "../../Assets/Scripts/Core/DimosState";

function makeRuntime(phase: "registration" | "runtime") {
  const reconnectEvent = {
    bind: vi.fn(),
    reset: vi.fn(),
  };
  const bridgeClient = {
    baseUrl: "192.168.1.62",
    createEvent: vi.fn(() => reconnectEvent),
    onHello: new Signal<unknown>(),
    onLidar: new Signal<unknown>(),
    onPose: new Signal<unknown>(),
    onWorldFrameCorrection: new Signal<unknown>(),
    onPath: new Signal<unknown>(),
    onNavStatus: new Signal<unknown>(),
    onRuntimeSnapshot: new Signal<unknown>(),
    onBridgeStatus: new Signal<unknown>(),
    onConnectionChanged: new Signal<boolean>(),
    onProtocolError: new Signal<unknown>(),
    isConnected: vi.fn(() => false),
    tryConnect: vi.fn(async () => false),
    disconnect: vi.fn(),
    lastBridgeStatus: null,
  };

  const dimosState = new DimosState();
  dimosState.update({ phase });

  const robotRuntime = {
    onDisconnect: vi.fn(),
    onLidar: vi.fn(),
    onPose: vi.fn(),
    onWorldFrameCorrection: vi.fn(),
    resetBridgeLidarModeTracking: vi.fn(),
    manualRegistrationAlignment: {
      onBridgeStatus: vi.fn(() => false),
      reset: vi.fn(),
    },
  };

  const navigationController = {
    applyPath: vi.fn(),
    applyNavStatus: vi.fn(),
    resyncPreviewGoal: vi.fn(),
    onDisconnect: vi.fn(),
    onHelloReset: vi.fn(),
    handleProtocolError: vi.fn(),
    resetForUserDisconnect: vi.fn(),
  };

  const runtime = new BridgeRuntime(
    bridgeClient as never,
    dimosState,
    robotRuntime as never,
    navigationController as never,
    null,
    null,
  );
  runtime.bind();

  return { runtime, bridgeClient, reconnectEvent };
}

describe("BridgeRuntime runtime reconnect", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).print = vi.fn();
    (globalThis as Record<string, unknown>).getTime = vi.fn(() => 0);
  });

  it("does not schedule reconnect during registration phase", () => {
    const { bridgeClient, reconnectEvent } = makeRuntime("registration");
    bridgeClient.onConnectionChanged.emit(false);
    expect(reconnectEvent.reset).not.toHaveBeenCalled();
    expect(bridgeClient.tryConnect).not.toHaveBeenCalled();
  });

  it("schedules reconnect after disconnect in runtime phase", () => {
    const { bridgeClient, reconnectEvent } = makeRuntime("runtime");
    bridgeClient.onConnectionChanged.emit(false);
    expect(reconnectEvent.reset).toHaveBeenCalledWith(1.0);
  });
});
