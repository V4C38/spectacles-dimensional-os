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

it("shows WebXR URL or Specs PIN and keeps IP in expanded details", () => {
  const { update } = launcher();
  const status = { host_ip: "192.168.1.2", pin: "012345", webxr_url: "https://192.168.1.2:5173" };
  update({ ...status, client: "webxr" });
  expect(element("connectionSummaryLabel").textContent).toBe("PIN");
  expect(document.querySelector("#urlSummary a")!.getAttribute("href")).toBe(status.webxr_url);
  expect(element("pinRow").classList.contains("hidden")).toBe(true);
  for (const client of ["specs", "webxr"]) {
    update({ ...status, client });
    expect(element("hostIpSummary").classList.contains("hidden")).toBe(true);
    expect(element("hostIpRow").classList.contains("hidden")).toBe(false);
    expect(element("hostIp").textContent).toBe(status.host_ip);
    if (client === "specs") {
      expect(element("connectionSummaryLabel").textContent).toBe("PIN");
      expect(element("pinSummary").textContent).toBe(status.pin);
    }
  }
});
