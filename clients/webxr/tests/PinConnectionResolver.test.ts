import { expect, it, vi } from "vitest";
import { resolvePinConnection } from "../src/websocket/PinConnectionResolver";

it("keeps control and bulk on the same secure gateway route", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ controlUrl: "/api/connections/opaque/control", bulkUrl: "/api/connections/opaque/bulk" })));
  await expect(resolvePinConnection("012345", "https://gateway:5173", fetcher)).resolves.toEqual({ controlUrl: "wss://gateway:5173/api/connections/opaque/control", bulkUrl: "wss://gateway:5173/api/connections/opaque/bulk" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ pin: "012345" });
});

it("rejects cross-route and cross-origin responses", async () => {
  for (const bulkUrl of ["/api/connections/other/bulk", "wss://other/bulk", "//other/bulk"]) {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ controlUrl: "/api/connections/opaque/control", bulkUrl })));
    await expect(resolvePinConnection("012345", "https://gateway", fetcher)).rejects.toThrow("Invalid connection route");
  }
});

it("reports gateway failures and validates before fetching", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "PIN expired" }), { status: 404 }));
  await expect(resolvePinConnection("012345", "https://gateway", fetcher)).rejects.toThrow("PIN expired");
  fetcher.mockClear();
  await expect(resolvePinConnection("12345", "https://gateway", fetcher)).rejects.toThrow("6-digit PIN");
  expect(fetcher).not.toHaveBeenCalled();
});
