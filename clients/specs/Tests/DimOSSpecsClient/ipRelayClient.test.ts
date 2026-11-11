import { describe, expect, it } from "vitest";
import {
  IpRelayClient,
  routeConnectionField,
  toggleConnectionMethod,
} from "../../Assets/Scripts/DimOSSpecsClient/IpRelayClient";

describe("PIN and IP routing", () => {
  it("resolves a PIN and switches the field to a typed IP", async () => {
    expect(routeConnectionField("pin", "123456")).toEqual({ kind: "pin", pin: "123456" });
    expect(routeConnectionField("pin", "192.168.1.9")).toBeNull();

    const client = new IpRelayClient({
      fetch: async () => ({
        status: 200,
        text: async () => JSON.stringify({ ip: "10.0.0.8", port: 8787 }),
      }),
    } as unknown as InternetModule);
    expect(await client.resolve("123456")).toEqual({ ip: "10.0.0.8", port: 8787 });

    const method = toggleConnectionMethod("pin");
    expect(method).toBe("ip");
    expect(routeConnectionField(method, "192.168.1.9")).toEqual({
      kind: "ip",
      host: "192.168.1.9",
    });
    expect(toggleConnectionMethod(method)).toBe("pin");
  });
});


it("rejects malformed resolved endpoints", async () => {
  for (const endpoint of [{ ip: "10.0.0.8", port: 0 }, { ip: "10.0.0.8", port: 1.5 }, { ip: "10.0.0.8", port: 65536 }, { ip: "bad/path", port: 8787 }]) {
    const client = new IpRelayClient({ fetch: async () => ({ status: 200, text: async () => JSON.stringify(endpoint) }) } as unknown as InternetModule);
    expect(await client.resolve("012345")).toBeNull();
  }
});

it("bounds outstanding native fetches when a relay request hangs", async () => {
  let finish!: (response: unknown) => void;
  let calls = 0;
  const client = new IpRelayClient({ fetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } as unknown as InternetModule);
  const first = client.resolve("012345");
  const duplicate = client.resolve("012345");
  expect(duplicate).toBe(first);
  expect(await client.resolve("654321")).toBeNull();
  expect(calls).toBe(1);
  finish({ status: 404 }); await first;
  expect(await duplicate).toBeNull();
  void client.resolve("654321"); expect(calls).toBe(2);
});

it("shares successful same-PIN lookups without extra native requests", async () => {
  let finish!: (response: unknown) => void;
  let calls = 0;
  const client = new IpRelayClient({ fetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } as unknown as InternetModule);
  const first = client.resolve("012345");
  const duplicate = client.resolve("012345");
  expect(calls).toBe(1);
  finish({ status: 200, text: async () => JSON.stringify({ ip: "10.0.0.8", port: 8787 }) });
  expect(await first).toEqual({ ip: "10.0.0.8", port: 8787 });
  expect(await duplicate).toEqual({ ip: "10.0.0.8", port: 8787 });
});
