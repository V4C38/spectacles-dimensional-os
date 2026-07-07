import { describe, it, expect, vi, beforeEach } from "vitest";
import { ARBridgeSession } from "../../Assets/Scripts/ARBridge/Network/ARBridgeSession";
import { Signal } from "../../Assets/Scripts/App/Utilities/Utilities";

type MockInbound = {
  helloReceived: boolean;
  waitForHello: ReturnType<typeof vi.fn>;
  onProtocolError: Signal<Error>;
  resetSessionState: ReturnType<typeof vi.fn>;
};

type MockTransport = {
  baseUrl: string;
  isSocketOpen: ReturnType<typeof vi.fn>;
  isConnecting: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  cancelConnect: ReturnType<typeof vi.fn>;
};

function makeSession(overrides?: {
  inbound?: Partial<MockInbound>;
  transport?: Partial<MockTransport>;
}) {
  const inbound: MockInbound = {
    helloReceived: false,
    waitForHello: vi.fn(async () => true),
    onProtocolError: new Signal<Error>(),
    resetSessionState: vi.fn(),
    ...overrides?.inbound,
  };
  const transport: MockTransport = {
    baseUrl: "",
    isSocketOpen: vi.fn(() => false),
    isConnecting: false,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    cancelConnect: vi.fn(),
    ...overrides?.transport,
  };

  const session = new ARBridgeSession() as ARBridgeSession & {
    _transport: MockTransport;
    _inbound: MockInbound;
    _connectAttemptId: number;
    _connectInFlight: Promise<boolean> | null;
    _connectInFlightIp: string | null;
    baseUrl: string;
    disconnect: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
  };

  session.baseUrl = "";
  session._transport = transport;
  session._inbound = inbound;
  session._connectAttemptId = 0;
  session._connectInFlight = null;
  session._connectInFlightIp = null;
  session.disconnect = vi.fn();
  session.isConnected = vi.fn(() => inbound.helloReceived && transport.isSocketOpen());

  return { session, inbound, transport };
}

describe("ARBridgeSession.tryConnect", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    (globalThis as Record<string, unknown>).print = vi.fn();
  });

  it("returns true when already connected to the same IP", async () => {
    const { session } = makeSession({
      inbound: { helloReceived: true },
      transport: { isSocketOpen: vi.fn(() => true) },
    });
    session.baseUrl = "192.168.1.10";
    let sessionReady = false;
    session.setOnSessionReady(() => {
      sessionReady = true;
    });

    await expect(session.tryConnect("192.168.1.10")).resolves.toBe(true);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(sessionReady).toBe(true);
  });

  it("disconnects when hello handshake times out", async () => {
    const { session, inbound } = makeSession({
      inbound: { waitForHello: vi.fn(async () => false) },
    });

    await expect(session.tryConnect("192.168.1.10")).resolves.toBe(false);
    expect(session.disconnect).toHaveBeenCalled();
    expect(inbound.waitForHello).toHaveBeenCalled();
  });

  it("coalesces concurrent tryConnect calls for the same IP", async () => {
    const { session, transport } = makeSession({
      inbound: {
        waitForHello: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              setTimeout(() => resolve(true), 20);
            }),
        ),
      },
    });

    const first = session.tryConnect("192.168.1.20");
    const second = session.tryConnect("192.168.1.20");
    expect(first).toBe(second);

    await expect(first).resolves.toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(1);
  }, 10000);

  it("cancels an in-flight connect when the IP changes", async () => {
    const resolvers: Array<(ok: boolean) => void> = [];
    const { session, transport } = makeSession({
      inbound: {
        waitForHello: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      },
    });

    const first = session.tryConnect("192.168.1.30");
    await Promise.resolve();
    const second = session.tryConnect("192.168.1.40");

    resolvers[0]?.(true);
    await expect(first).resolves.toBe(false);

    resolvers[1]?.(true);
    await expect(second).resolves.toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(2);
    expect(session.baseUrl).toBe("192.168.1.40");
  });

  it("reuses an open socket when hello is still pending", async () => {
    const { session, transport, inbound } = makeSession({
      transport: {
        isSocketOpen: vi.fn(() => true),
        isConnecting: false,
      },
      inbound: {
        helloReceived: false,
        waitForHello: vi.fn(async () => true),
      },
    });
    session.baseUrl = "192.168.1.55";

    await expect(session.tryConnect("192.168.1.55")).resolves.toBe(true);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(transport.connect).not.toHaveBeenCalled();
    expect(inbound.waitForHello).toHaveBeenCalled();
  });

  it("uses cancelConnect when superseding an in-flight connect", async () => {
    const { session, transport } = makeSession({
      transport: {
        isConnecting: true,
        connect: vi.fn(async () => {}),
      },
    });

    await session.tryConnect("192.168.1.30");
    await Promise.resolve();
    session.tryConnect("192.168.1.40");
    await Promise.resolve();

    expect(transport.cancelConnect).toHaveBeenCalled();
  });
});
