import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistrationClient } from "../../Assets/Scripts/ARBridge/Registration/RegistrationClient";
import { RegistrationStatusMessage } from "../../Assets/Scripts/ARBridge/Network/Protocol";
import { setMockTime } from "../setup/lens-globals";

function makeSession() {
  return {
    isConnected: vi.fn(() => true),
    onConnectionChanged: { add: vi.fn() },
  };
}

function makeInbound() {
  return {
    activeRobotId: "go2",
    onRegistrationStatus: { add: vi.fn() },
    onHello: { add: vi.fn() },
  };
}

function makeTransport() {
  return {
    send: vi.fn(() => true),
  };
}

function makeRegistrationClient(session = makeSession(), transport = makeTransport()) {
  const inbound = makeInbound();
  const frameCapture = {
    setMode: vi.fn(),
    setCapturePolicy: vi.fn(),
  };
  const client = new RegistrationClient(
    session as any,
    transport as any,
    inbound as any,
    frameCapture as any,
    null,
  );
  return { client, session, transport, inbound, frameCapture };
}

describe("RegistrationClient", () => {
  beforeEach(() => {
    setMockTime(100);
  });

  it("starts april_tag session and activates tag capture latch", () => {
    const { client, transport } = makeRegistrationClient();
    let captureChanged = 0;
    client.onCapturePolicyInputsChanged.add(() => {
      captureChanged += 1;
    });

    client.start("april_tag");

    expect(transport.send).toHaveBeenCalled();
    expect(client.tagCaptureSessionActive).toBe(true);
    expect(client.registrationCaptureHint).toBe("steady");
    expect(captureChanged).toBe(1);
    expect(client.hasActiveIntent()).toBe(true);
  });

  it("maps registration_status capture hints to registrationCaptureHint", () => {
    const { client, inbound } = makeRegistrationClient();
    client.start("april_tag");

    let statusHandler: (msg: RegistrationStatusMessage) => void = () => {};
    inbound.onRegistrationStatus.add.mockImplementation((handler: typeof statusHandler) => {
      statusHandler = handler;
    });
    client.bind();

    statusHandler({
      type: "registration_status",
      ts: 1,
      robot_id: "go2",
      mode: "april_tag",
      phase: "scanning",
      capture: "burst",
      message: "Collecting samples",
    });
    expect(client.registrationCaptureHint).toBe("burst");

    statusHandler({
      type: "registration_status",
      ts: 2,
      robot_id: "go2",
      mode: "april_tag",
      phase: "scanning",
      capture: "steady",
      message: "Hold steady",
    });
    expect(client.registrationCaptureHint).toBe("steady");
  });

  it("clears intent and tag latch on failed registration_status", () => {
    const { client, inbound } = makeRegistrationClient();
    client.start("april_tag");

    let statusHandler: (msg: RegistrationStatusMessage) => void = () => {};
    inbound.onRegistrationStatus.add.mockImplementation((handler: typeof statusHandler) => {
      statusHandler = handler;
    });
    client.bind();

    statusHandler({
      type: "registration_status",
      ts: 1,
      robot_id: "go2",
      mode: "april_tag",
      phase: "failed",
      capture: "off",
      message: "Tag lost",
    });

    expect(client.hasActiveIntent()).toBe(false);
    expect(client.tagCaptureSessionActive).toBe(false);
    expect(client.registrationCaptureHint).toBe("off");
  });

  it("uses registration capabilities for preferred mode", () => {
    const { client } = makeRegistrationClient();
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
    const { client, transport } = makeRegistrationClient();

    client.stop({ notifyBridge: true });

    expect(transport.send).toHaveBeenCalled();
  });

  it("stop without notifyBridge does not send bridge command", () => {
    const { client, transport } = makeRegistrationClient();

    client.stop();

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("stop after succeeded registration_status does not notify bridge", () => {
    const { client, inbound, transport } = makeRegistrationClient();
    client.start("manual_pose");
    client.commit();

    let statusHandler: (msg: RegistrationStatusMessage) => void = () => {};
    inbound.onRegistrationStatus.add.mockImplementation((handler: typeof statusHandler) => {
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

    transport.send.mockClear();
    client.stop();

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("commit sets awaitingCommit", () => {
    const { client } = makeRegistrationClient();
    client.start("manual_pose");
    client.commit();

    expect(client.awaitingCommit).toBe(true);
  });

  it("start clears prior session state", () => {
    const { client } = makeRegistrationClient();
    client.start("april_tag");
    expect(client.tagCaptureSessionActive).toBe(true);

    client.start("manual_pose");
    expect(client.tagCaptureSessionActive).toBe(false);
  });
});
