// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { settingsWriter, profilesForRobot } from "../../../launcher/app/static/persistence.mjs";
import { launcherPresentation } from "../../../launcher/app/static/presentation.mjs";
import { sourceRequest, replayRobot, replayPreferenceKey } from "../../../launcher/app/static/source-selection.mjs";
import { logConsole } from "../../../launcher/app/static/log-console.mjs";

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
  Object.assign(window, { settingsWriter, profilesForRobot, launcherPresentation, logConsole, sourceRequest, replayRobot, replayPreferenceKey });
  window.eval(script.replace(/^import .*;\n/gm, ""));
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

it("loads canonical defaults and flushes an autosave before changing profiles", async () => {
  const defaults = { marker_id: 0, print_size_mm: 70, forward_m: 0.18, lateral_m: 0,
    up_m: 0.06, yaw_deg: -90, pitch_deg: -15, roll_deg: 0 };
  const policy = { travel_threshold_m: 0.75, heading_threshold_deg: 30,
    marker_preference_s: 3, headset_travel_threshold_m: 10 };
  const settings = { ...policy, mounts: [defaults], fiducial_marker: true, vps: false, map_code: "" };
  const profiles = [
    { id: "A", name: "First", robot: "unitree_go2", settings: { ...settings, marker_preference_s: 1.5 } },
    { id: "B", name: "Second", robot: "unitree_go2", settings: { ...settings, marker_preference_s: 0 } },
  ];
  const writes: { body: any; resolve: (value: any) => void }[] = [];
  const json = (data: unknown) => ({ ok: true, json: async () => data });
  document.documentElement.innerHTML = html;
  localStorage.clear();
  let events!: { onmessage: ((event: { data: string }) => void) | null };
  vi.stubGlobal("EventSource", class { onmessage = null; constructor() { events = this; } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/settings" && options?.method === "PUT")
      return new Promise(resolve => writes.push({ body: JSON.parse(options.body as string), resolve }));
    if (url === "/api/settings") return json({ ...settings, defaults: { mounts: [defaults], preset_marker_ids: [0, 1, 2], localization: policy } });
    if (url === "/api/robot-profiles") return json({ profiles });
    if (url === "/api/status") return json({ phase: "ready", check_ok: true });
    return { ok: false, json: async () => ({}) };
  }));
  Object.assign(window, { settingsWriter, profilesForRobot, launcherPresentation, logConsole, sourceRequest, replayRobot, replayPreferenceKey });
  window.eval(script.replace(/^import .*;\n/gm, ""));
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 6; i++) await tick();
  const preference = element("marker_preference_s") as HTMLInputElement;
  expect(preference.value).toBe("1.5");
  preference.value = "2";
  const key = element("apiKey") as HTMLInputElement;
  key.value = "new-unsaved-key";
  preference.dispatchEvent(new Event("change"));
  const select = element("robotProfileSelect") as HTMLSelectElement;
  select.value = "B";
  select.dispatchEvent(new Event("change"));
  for (let i = 0; i < 4; i++) await tick();
  expect(writes).toHaveLength(1);
  expect(writes[0].body.profile_id).toBe("A");
  expect(writes[0].body.marker_preference_s).toBe(2);
  expect(writes[0].body.openai_api_key).toBe("new-unsaved-key");
  events.onmessage!({ data: JSON.stringify({ type: "status", phase: "ready", check_ok: true, openai_api_key: "old-key" }) });
  expect(key.value).toBe("new-unsaved-key");
  expect(preference.value).toBe("2");
  writes[0].resolve(json({ ...settings, marker_preference_s: 2 }));
  for (let i = 0; i < 4; i++) await tick();
  expect(preference.value).toBe("0");
  select.value = "A";
  select.dispatchEvent(new Event("change"));
  for (let i = 0; i < 4; i++) await tick();
  expect(writes[1].body.profile_id).toBe("B");
  expect(writes[1].body.marker_preference_s).toBe(0);
  writes[1].resolve(json({ ...settings, marker_preference_s: 0 }));
  for (let i = 0; i < 4; i++) await tick();
  expect(preference.value).toBe("2");
});
