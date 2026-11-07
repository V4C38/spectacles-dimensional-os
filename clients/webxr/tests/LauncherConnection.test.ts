// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("../../launcher/app/static/index.html", "utf8");
const script = readFileSync("../../launcher/app/static/app.js", "utf8");
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.innerHTML = ""; });

function launcher() {
  document.documentElement.innerHTML = html;
  let events!: { onmessage: ((event: { data: string }) => void) | null };
  vi.stubGlobal("EventSource", class {
    onmessage = null;
    constructor() { events = this; }
  });
  const request = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
  vi.stubGlobal("fetch", request);
  window.eval(script);
  const update = (status: object) => events.onmessage!({ data: JSON.stringify({ type: "status", phase: "running", ...status }) });
  return { update, request };
}
const element = (id: string) => document.getElementById(id)!;
const button = (id: string) => element(id) as HTMLButtonElement;

it("shows the shared PIN and WebXR URL together regardless of startup preference", async () => {
  const { update } = launcher();
  const shared = { host_ip: "192.168.1.2", pin: "012345", webxr_phase: "running", webxr_url: "https://192.168.1.2:5173" };
  for (const client of ["webxr", "specs"]) {
    update({ ...shared, client });
    expect(element("connectionSummaryLabel").textContent).toBe("PIN");
    expect(element("pinSummary").textContent).toBe("012345");
    expect(document.querySelector("#webxrNetwork a")!.getAttribute("href")).toBe(shared.webxr_url);
    for (const id of ["pinRow", "hostIpSummary", "hostIpRow", "webxrNetworkRow"]) {
      expect(element(id).classList.contains("hidden")).toBe(false);
    }
  }
  update({ ...shared, phase: "idle", client: "specs" });
  buttonFromPreference("webxr").click();
  expect(element("connectionSummaryLabel").textContent).toBe("PIN");
  expect(element("pinSummary").textContent).toBe("012345");
  expect(element("webxrNetworkRow").classList.contains("hidden")).toBe(false);
  await Promise.resolve();
});

function buttonFromPreference(client: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-client="${client}"]`)!;
}

it("controls WebXR independently of backend state and retains PIN after gateway failure", async () => {
  const { update, request } = launcher();
  update({ phase: "idle", webxr_phase: "running", webxr_url: "https://192.168.1.2:5173" });
  expect(button("startWebxrBtn").disabled).toBe(true);
  expect(button("stopWebxrBtn").disabled).toBe(false);
  button("stopWebxrBtn").click();
  expect(request).toHaveBeenCalledWith("/api/webxr/stop", { method: "POST" });
  await Promise.resolve();
  await Promise.resolve();

  update({ client: "specs", pin: "012345", webxr_phase: "error", webxr_error: "WebXR exited", webxr_url: null });
  expect(element("webxrServiceStatus").textContent).toBe("WebXR exited");
  expect(element("pinSummary").textContent).toBe("012345");
  expect(element("webxrNetworkRow").classList.contains("hidden")).toBe(true);
  expect(button("startWebxrBtn").disabled).toBe(false);
  expect(button("stopWebxrBtn").disabled).toBe(true);
  button("startWebxrBtn").click();
  expect(request).toHaveBeenCalledWith("/api/webxr/start", { method: "POST" });
  button("stopBackendBtn").click();
  expect(request).toHaveBeenCalledWith("/api/backend/stop", { method: "POST" });
  await Promise.resolve();
  await Promise.resolve();
});
