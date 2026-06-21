import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistrationClient } from "../../Assets/Scripts/Registration/RegistrationClient";
import { RegistrationStatusMessage } from "../../Assets/Scripts/Bridge/Protocol";
import { setMockTime } from "../setup/lens-globals";

function makeBridgeClient() {
  return {
    isConnected: vi.fn(() => true),
    activeRobotId: "go2",
    lastBridgeStatus: { registered: false },
    sendRegistrationCommand: vi.fn(() => true),
    sendRegistrationPose: vi.fn(() => true),
    onRegistrationStatus: { add: vi.fn() },
    onConnectionChanged: { add: vi.fn() },
    onHello: { add: vi.fn() },
  };
}

function makeFrameCapture() {
  return {
    setMode: vi.fn(),
    setCapturePolicy: vi.fn(),
  };
}

describe("RegistrationClient", () => {
  beforeEach(() => {
    setMockTime(100);
  });

  it("starts april_odom_baseline session and enables setup capture", () => {
    const bridge = makeBridgeClient();
    const frameCapture = makeFrameCapture();
    const client = new RegistrationClient(bridge as any, frameCapture as any, null);

    client.start("april_odom_baseline");

    expect(bridge.sendRegistrationCommand).toHaveBeenCalledWith(
      "start",
      "april_odom_baseline",
    );
    expect(frameCapture.setMode).toHaveBeenCalledWith("setup");
    expect(frameCapture.setCapturePolicy).toHaveBeenCalledWith("steady");
    expect(client.hasActiveIntent()).toBe(true);
  });

  it("maps registration_status capture hints to frame capture policy", () => {
    const bridge = makeBridgeClient();
    const frameCapture = makeFrameCapture();
    const client = new RegistrationClient(bridge as any, frameCapture as any, null);
    client.start("april_odom_baseline");

    let statusHandler: (msg: RegistrationStatusMessage) => void = () => {};
    bridge.onRegistrationStatus.add.mockImplementation((handler: typeof statusHandler) => {
      statusHandler = handler;
    });
    client.bind();

    statusHandler({
      type: "registration_status",
      ts: 1,
      robot_id: "go2",
      mode: "april_odom_baseline",
      phase: "sampling",
      capture: "burst",
      message: "Sampling",
    });
    expect(frameCapture.setCapturePolicy).toHaveBeenCalledWith("burst");

    statusHandler({
      type: "registration_status",
      ts: 2,
      robot_id: "go2",
      mode: "april_odom_baseline",
      phase: "moving",
      capture: "hold",
      message: "Moving",
    });
    expect(frameCapture.setCapturePolicy).toHaveBeenCalledWith("hold");
  });

  it("clears intent on failed registration_status", () => {
    const bridge = makeBridgeClient();
    const frameCapture = makeFrameCapture();
    const client = new RegistrationClient(bridge as any, frameCapture as any, null);
    client.start("april_odom_baseline");

    let statusHandler: (msg: RegistrationStatusMessage) => void = () => {};
    bridge.onRegistrationStatus.add.mockImplementation((handler: typeof statusHandler) => {
      statusHandler = handler;
    });
    client.bind();

    statusHandler({
      type: "registration_status",
      ts: 1,
      robot_id: "go2",
      mode: "april_odom_baseline",
      phase: "failed",
      capture: "off",
      message: "Tag lost",
    });

    expect(client.hasActiveIntent()).toBe(false);
    expect(frameCapture.setMode).toHaveBeenCalledWith("off");
  });

  it("uses registration capabilities for preferred mode", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);
    client.initialize({
      poseCorrection: { reset: vi.fn() } as any,
      hasBridgeConnection: () => true,
      isCapabilityAvailable: (cap) => cap === "registration_manual_pose",
      getInteractionMode: () => "hidden",
      setInteractionMode: vi.fn(),
      getIsRuntimePhase: () => false,
      disableNavigationPlacementForRegistration: vi.fn(),
    });

    expect(client.preferredMode()).toBe("manualOnly");
  });

  it("stop with notifyBridge sends stop when no local session", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);

    client.stop({ notifyBridge: true });

    expect(bridge.sendRegistrationCommand).toHaveBeenCalledWith("stop");
  });

  it("stop without notifyBridge no-ops when no local session", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);

    client.stop();

    expect(bridge.sendRegistrationCommand).not.toHaveBeenCalled();
  });
});
