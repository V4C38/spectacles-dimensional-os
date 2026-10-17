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
