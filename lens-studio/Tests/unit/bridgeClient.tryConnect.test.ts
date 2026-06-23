import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeClient } from "../../Assets/Scripts/Bridge/BridgeClient";
import { Signal } from "../../Assets/Scripts/Core/Utilities";

type MockInbound = {
  helloReceived: boolean;
  waitForHello: ReturnType<typeof vi.fn>;
  onProtocolError: Signal<Error>;
  resetSessionState: ReturnType<typeof vi.fn>;
};

type MockConnection = {
  baseUrl: string;
  isSocketOpen: ReturnType<typeof vi.fn>;
  isConnecting: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function makeClient(overrides?: {
  inbound?: Partial<MockInbound>;
  connection?: Partial<MockConnection>;
}) {
  const inbound: MockInbound = {
    helloReceived: false,
    waitForHello: vi.fn(async () => true),
    onProtocolError: new Signal<Error>(),
    resetSessionState: vi.fn(),
    ...overrides?.inbound,
  };
  const connection: MockConnection = {
    baseUrl: "",
    isSocketOpen: vi.fn(() => false),
    isConnecting: false,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    ...overrides?.connection,
  };

  const client = new BridgeClient() as BridgeClient & {
    _connection: MockConnection;
    _inbound: MockInbound;
    _connectAttemptId: number;
    _connectInFlight: Promise<boolean> | null;
    _connectInFlightIp: string | null;
    baseUrl: string;
    disconnect: ReturnType<typeof vi.fn>;
    requestStatus: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
  };

  client.baseUrl = "";
  client._connection = connection;
  client._inbound = inbound;
  client._connectAttemptId = 0;
  client._connectInFlight = null;
  client._connectInFlightIp = null;
  client.disconnect = vi.fn();
  client.requestStatus = vi.fn(() => true);
  client.isConnected = vi.fn(() => inbound.helloReceived && connection.isSocketOpen());

  return { client, inbound, connection };
}

describe("BridgeClient.tryConnect", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    (globalThis as Record<string, unknown>).print = vi.fn();
  });

  it("returns true when already connected to the same IP", async () => {
    const { client } = makeClient({
      inbound: { helloReceived: true },
      connection: { isSocketOpen: vi.fn(() => true) },
    });
    client.baseUrl = "192.168.1.10";

    await expect(client.tryConnect("192.168.1.10")).resolves.toBe(true);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.requestStatus).toHaveBeenCalled();
  });

  it("disconnects when hello handshake times out", async () => {
    const { client, inbound } = makeClient({
      inbound: { waitForHello: vi.fn(async () => false) },
    });

    await expect(client.tryConnect("192.168.1.10")).resolves.toBe(false);
    expect(client.disconnect).toHaveBeenCalled();
    expect(inbound.waitForHello).toHaveBeenCalled();
  });

  it("coalesces concurrent tryConnect calls for the same IP", async () => {
    const { client, connection } = makeClient({
      inbound: {
        waitForHello: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              setTimeout(() => resolve(true), 20);
            }),
        ),
      },
    });

    const first = client.tryConnect("192.168.1.20");
    const second = client.tryConnect("192.168.1.20");
    expect(first).toBe(second);

    await expect(first).resolves.toBe(true);
    expect(connection.connect).toHaveBeenCalledTimes(1);
  }, 10000);

  it("cancels an in-flight connect when the IP changes", async () => {
    const resolvers: Array<(ok: boolean) => void> = [];
    const { client, connection } = makeClient({
      inbound: {
        waitForHello: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      },
    });

    const first = client.tryConnect("192.168.1.30");
    await Promise.resolve();
    const second = client.tryConnect("192.168.1.40");

    resolvers[0]?.(true);
    await expect(first).resolves.toBe(false);

    resolvers[1]?.(true);
    await expect(second).resolves.toBe(true);
    expect(connection.connect).toHaveBeenCalledTimes(2);
    expect(client.baseUrl).toBe("192.168.1.40");
  });
});
