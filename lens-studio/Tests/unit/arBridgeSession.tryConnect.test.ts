import { describe, it, expect, vi, beforeEach } from "vitest";
import { ARBridgeSession } from "../../Assets/Scripts/ARBridge/Network/ARBridgeSession";

type MockInbound = {
  helloReceived: boolean;
  waitForHello: ReturnType<typeof vi.fn>;
  resetSessionState: ReturnType<typeof vi.fn>;
};

type MockTransport = {
  baseUrl: string;
  openHost: string | null;
  isSocketOpen: ReturnType<typeof vi.fn>;
  isConnecting: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onBridgeConnectionChanged: ReturnType<typeof vi.fn>;
};

function makeSession(overrides?: {
  inbound?: Partial<MockInbound>;
  transport?: Partial<MockTransport>;
}) {
  const inbound: MockInbound = {
    helloReceived: false,
    waitForHello: vi.fn(async () => true),
    resetSessionState: vi.fn(() => {
      inbound.helloReceived = false;
    }),
    ...overrides?.inbound,
  };
  const transport: MockTransport = {
    baseUrl: "",
    openHost: null,
    isSocketOpen: vi.fn(() => false),
    isConnecting: false,
    connect: vi.fn(async () => {
      transport.openHost = WebSocketTransportNormalize(transport.baseUrl);
      transport.isSocketOpen.mockReturnValue(true);
    }),
    disconnect: vi.fn(() => {
      transport.openHost = null;
      transport.isSocketOpen.mockReturnValue(false);
    }),
    onBridgeConnectionChanged: vi.fn(),
    ...overrides?.transport,
  };

  const session = new ARBridgeSession() as ARBridgeSession & {
    _transport: MockTransport;
    _inbound: MockInbound;
    baseUrl: string;
  };

  session.baseUrl = "";
  session._transport = transport;
  session._inbound = inbound;

  return { session, inbound, transport };
}

function WebSocketTransportNormalize(raw: string): string {
  return ARBridgeSession.normalizeIp(raw);
}

describe("ARBridgeSession.checkConnection", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    (globalThis as Record<string, unknown>).print = vi.fn();
  });

  it("returns true when already connected to the same IP", async () => {
    const { session, transport, inbound } = makeSession({
      inbound: { helloReceived: true },
      transport: {
        isSocketOpen: vi.fn(() => true),
        openHost: "192.168.1.10",
      },
    });
    session.baseUrl = "192.168.1.10";
    transport.baseUrl = "192.168.1.10";
    let sessionReady = false;
    session.setOnSessionReady(() => {
      sessionReady = true;
    });

    await expect(session.checkConnection()).resolves.toBe(true);
    expect(transport.connect).not.toHaveBeenCalled();
    expect(inbound.waitForHello).not.toHaveBeenCalled();
    expect(sessionReady).toBe(true);
  });

  it("disconnects when hello handshake times out", async () => {
    const { session, inbound, transport } = makeSession({
      inbound: { waitForHello: vi.fn(async () => false) },
    });
    session.baseUrl = "192.168.1.10";

    await expect(session.checkConnection()).resolves.toBe(false);
    expect(transport.connect).toHaveBeenCalled();
    expect(inbound.waitForHello).toHaveBeenCalled();
    expect(inbound.resetSessionState).toHaveBeenCalled();
  });

  it("waits for hello when socket is already open to the same host", async () => {
    const { session, transport, inbound } = makeSession({
      transport: {
        isSocketOpen: vi.fn(() => true),
        openHost: "192.168.1.55",
      },
      inbound: {
        helloReceived: false,
        waitForHello: vi.fn(async () => true),
      },
    });
    session.baseUrl = "192.168.1.55";
    transport.baseUrl = "192.168.1.55";

    await expect(session.checkConnection()).resolves.toBe(true);
    expect(transport.connect).not.toHaveBeenCalled();
    expect(inbound.waitForHello).toHaveBeenCalled();
  });

  it("reconnects when already connected to a different IP", async () => {
    const { session, transport, inbound } = makeSession({
      inbound: {
        helloReceived: true,
        waitForHello: vi.fn(async () => true),
      },
      transport: {
        isSocketOpen: vi.fn(() => true),
        openHost: "192.168.1.10",
      },
    });
    session.baseUrl = "192.168.1.11";

    await expect(session.checkConnection()).resolves.toBe(true);
    expect(transport.disconnect).toHaveBeenCalled();
    expect(transport.connect).toHaveBeenCalled();
    expect(session.baseUrl).toBe("192.168.1.11");
    expect(inbound.waitForHello).toHaveBeenCalled();
  });

  it("tryConnect sets baseUrl then checkConnection", async () => {
    const { session, transport } = makeSession();

    await expect(session.tryConnect("192.168.1.40")).resolves.toBe(true);
    expect(session.baseUrl).toBe("192.168.1.40");
    expect(transport.baseUrl).toBe("192.168.1.40");
    expect(transport.connect).toHaveBeenCalled();
  });

  it("does not disconnect while a connect is in flight", async () => {
    const { session, transport } = makeSession({
      transport: { isConnecting: true },
    });
    session.baseUrl = "192.168.1.101";

    await expect(session.checkConnection()).resolves.toBe(true);
    expect(transport.disconnect).not.toHaveBeenCalled();
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });

  it("returns false when the in-flight attempt lands on a different host", async () => {
    const { session, transport, inbound } = makeSession();
    transport.connect = vi.fn(async () => {
      // Attempt was already targeting the old host when awaited.
      transport.openHost = "192.168.1.96";
      transport.isSocketOpen.mockReturnValue(true);
    });
    session.baseUrl = "192.168.1.101";

    await expect(session.checkConnection()).resolves.toBe(false);
    expect(inbound.waitForHello).not.toHaveBeenCalled();
    // The mismatched socket is left for the next retry to replace.
    expect(transport.disconnect).not.toHaveBeenCalled();
  });

  it("does not disconnect from the failure path when connect rejects", async () => {
    const { session, transport } = makeSession();
    transport.connect = vi.fn(async () => {
      throw new Error("WebSocket connection timeout");
    });
    session.baseUrl = "192.168.1.101";

    await expect(session.checkConnection()).resolves.toBe(false);
    // Transport cleaned up its own attempt; session must not cascade a
    // disconnect that could kill a newer attempt.
    expect(transport.disconnect).not.toHaveBeenCalled();
  });
});
