import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistrationClient } from "../../Assets/Scripts/Registration/RegistrationClient";
import { RegistrationStatusMessage } from "../../Assets/Scripts/Bridge/Protocol";
import { setMockTime } from "../setup/lens-globals";

function makeBridgeClient() {
  return {
    isConnected: vi.fn(() => true),
    activeRobotId: "go2",
    lastBridgeStatus: { world_frame_committed: false },
    sendRegistrationCommand: vi.fn(() => true),
    sendRegistrationPose: vi.fn(() => true),
    onRegistrationStatus: { add: vi.fn() },
    onConnectionChanged: { add: vi.fn() },
    onHello: { add: vi.fn() },
    onBridgeStatus: { add: vi.fn() },
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

  it("starts april_odom_baseline session and activates baseline capture latch", () => {
    const bridge = makeBridgeClient();
    const frameCapture = makeFrameCapture();
    const client = new RegistrationClient(bridge as any, frameCapture as any, null);
    let captureChanged = 0;
    client.onCapturePolicyInputsChanged.add(() => {
      captureChanged += 1;
    });

    client.start("april_odom_baseline");

    expect(bridge.sendRegistrationCommand).toHaveBeenCalledWith(
      "start",
      "april_odom_baseline",
    );
    expect(client.baselineCaptureSessionActive).toBe(true);
    expect(client.registrationCaptureHint).toBe("steady");
    expect(captureChanged).toBe(1);
    expect(client.hasActiveIntent()).toBe(true);
  });

  it("maps registration_status capture hints to registrationCaptureHint", () => {
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
    expect(client.registrationCaptureHint).toBe("burst");

    statusHandler({
      type: "registration_status",
      ts: 2,
      robot_id: "go2",
      mode: "april_odom_baseline",
      phase: "moving",
      capture: "hold",
      message: "Moving",
    });
    expect(client.registrationCaptureHint).toBe("hold");
  });

  it("clears intent and baseline latch on failed registration_status", () => {
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
    expect(client.baselineCaptureSessionActive).toBe(false);
    expect(client.registrationCaptureHint).toBe("off");
  });

  it("uses registration capabilities for preferred mode", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);
    client.initialize({
      manualRegistrationAlignment: { reset: vi.fn() } as any,
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

  it("stop without notifyBridge does not send bridge command", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);

    client.stop();

    expect(bridge.sendRegistrationCommand).not.toHaveBeenCalled();
  });

  it("stop after succeeded registration_status does not notify bridge", () => {
    const bridge = makeBridgeClient();
    const frameCapture = makeFrameCapture();
    const client = new RegistrationClient(bridge as any, frameCapture as any, null);
    client.start("manual_pose");
    client.commit();

    let statusHandler: (msg: RegistrationStatusMessage) => void = () => {};
    bridge.onRegistrationStatus.add.mockImplementation((handler: typeof statusHandler) => {
      statusHandler = handler;
    });
    client.bind();

    statusHandler({
      type: "registration_status",
      ts: 1,
      robot_id: "go2",
      mode: "manual_pose",
      phase: "succeeded",
      capture: "off",
      message: "Manual registration committed",
    });

    client.stop();

    expect(bridge.sendRegistrationCommand).not.toHaveBeenCalledWith("stop");
  });

  it("commit sets awaitingCommit", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);
    client.start("manual_pose");
    client.commit();

    expect(client.awaitingCommit).toBe(true);
  });

  it("requestMotionAuthorization sets pending and sends authorize_motion", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);

    expect(client.requestMotionAuthorization()).toBe(true);
    expect(client.motionAuthorizePending).toBe(true);
    expect(bridge.sendRegistrationCommand).toHaveBeenCalledWith("authorize_motion");
  });

  it("requestMotionAuthorization blocks duplicate calls while pending", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);

    expect(client.requestMotionAuthorization()).toBe(true);
    expect(client.requestMotionAuthorization()).toBe(false);
    expect(bridge.sendRegistrationCommand).toHaveBeenCalledTimes(1);
  });

  it("clears motion authorize pending when phase leaves awaiting_motion", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);
    client.start("april_odom_baseline");
    client.requestMotionAuthorization();

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
      phase: "moving",
      capture: "hold",
      message: "Moving",
    });

    expect(client.motionAuthorizePending).toBe(false);
  });

  it("stop clears motion authorize pending", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);
    client.requestMotionAuthorization();

    client.stop({ notifyBridge: true });

    expect(client.motionAuthorizePending).toBe(false);
  });

  it("start clears motion authorize pending", () => {
    const bridge = makeBridgeClient();
    const client = new RegistrationClient(bridge as any, null, null);
    client.requestMotionAuthorization();

    client.start("april_odom_baseline");

    expect(client.motionAuthorizePending).toBe(false);
  });
});
