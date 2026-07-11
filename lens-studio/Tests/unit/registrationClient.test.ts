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
  const client = new RegistrationClient(
    session as any,
    transport as any,
    inbound as any,
    null,
  );
  return { client, session, transport, inbound };
}

describe("RegistrationClient", () => {
  beforeEach(() => {
    setMockTime(100);
  });

  it("starts april_tag session when connected", () => {
    const { client, transport } = makeRegistrationClient();

    client.start("april_tag");

    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(client.hasActiveIntent()).toBe(true);
  });

  it("start sends bridge stop before start when connected", () => {
    const { client, transport } = makeRegistrationClient();

    client.start("april_tag");

    const payloads = transport.send.mock.calls.map((call) =>
      JSON.parse(String(call[0]).trim()),
    );
    expect(payloads).toHaveLength(2);
    expect(payloads[0].command).toBe("stop");
    expect(payloads[1].command).toBe("start");
    expect(payloads[1].mode).toBe("april_tag");
  });

  it("start skips bridge stop when disconnected", () => {
    const session = makeSession();
    session.isConnected = vi.fn(() => false);
    const { client, transport } = makeRegistrationClient(session);

    client.start("april_tag");

    expect(transport.send).not.toHaveBeenCalled();
    expect(client.hasActiveIntent()).toBe(true);
  });

  it("stop clears intent", () => {
    const { client } = makeRegistrationClient();

    client.start("april_tag");
    client.stop();

    expect(client.hasActiveIntent()).toBe(false);
  });

  it("clears intent on failed registration_status", () => {
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
      message: "Tag lost",
    });

    expect(client.hasActiveIntent()).toBe(false);
  });

  it("clears intent on succeeded registration_status", () => {
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
      phase: "succeeded",
      message: "Registration successful",
    });

    expect(client.hasActiveIntent()).toBe(false);
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
    expect(client.hasActiveIntent()).toBe(true);

    client.start("manual_pose");
    expect(client.hasActiveIntent()).toBe(true);
  });
});
