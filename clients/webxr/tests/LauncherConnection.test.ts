// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("../../launcher/app/static/index.html", "utf8");
const script = readFileSync("../../launcher/app/static/app.js", "utf8");
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.innerHTML = ""; });

it("shows the headset URL in WebXR mode and restores the PIN in Specs mode", async () => {
  document.documentElement.innerHTML = html;
  let events!: { onmessage: ((event: { data: string }) => void) | null };
  vi.stubGlobal("EventSource", class {
    onmessage = null;
    constructor() { events = this; }
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  window.eval(script);
  const update = (status: object) => events.onmessage!({ data: JSON.stringify({ type: "status", phase: "running", ...status }) });
  update({ client: "webxr", host_ip: "192.168.1.2", pin: "123456", webxr_url: "https://192.168.1.2:5173", webxr_local_url: "https://localhost:5173" });
  expect(document.getElementById("connectionSummaryLabel")!.textContent).toBe("URL");
  expect(document.querySelector("#pinSummary a")!.getAttribute("href")).toBe("https://192.168.1.2:5173");
  expect(document.getElementById("pinRow")!.classList.contains("hidden")).toBe(true);
  expect(document.getElementById("hostIpSummary")!.classList.contains("hidden")).toBe(true);
  expect(document.getElementById("hostIpRow")!.classList.contains("hidden")).toBe(true);
  expect(document.getElementById("webxrLocalRow")).toBeNull();
  expect(document.getElementById("webxrNetworkRow")!.classList.contains("hidden")).toBe(false);
  update({ client: "specs", pin: "654321" });
  expect(document.getElementById("connectionSummaryLabel")!.textContent).toBe("PIN");
  expect(document.getElementById("pinSummary")!.textContent).toBe("654321");
  expect(document.getElementById("pinRow")!.classList.contains("hidden")).toBe(false);
  expect(document.getElementById("webxrNetworkRow")!.classList.contains("hidden")).toBe(true);
  update({ phase: "idle", client: "specs", pin: "654321" });
  (document.querySelector('[data-client="webxr"]') as HTMLButtonElement).click();
  expect(document.getElementById("connectionSummaryLabel")!.textContent).toBe("URL");
  expect(document.getElementById("hostIpRow")!.classList.contains("hidden")).toBe(true);
  expect(document.getElementById("pinRow")!.classList.contains("hidden")).toBe(true);
  (document.querySelector('[data-client="specs"]') as HTMLButtonElement).click();
  expect(document.getElementById("hostIpRow")!.classList.contains("hidden")).toBe(false);
  await Promise.resolve();
});
