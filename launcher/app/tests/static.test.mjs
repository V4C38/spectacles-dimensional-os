import test from "node:test";
import assert from "node:assert/strict";
import { settingsWriter, profilesForRobot } from "../static/persistence.mjs";
import { launcherPresentation } from "../static/presentation.mjs";
import { sourceRequest } from "../static/source-selection.mjs";

const response = data => ({ ok: true, json: async () => data });

test("settings saves retain profile/value identity, serialize and recover from failure", async () => {
  const pending = [], saved = [], failed = [];
  const writer = settingsWriter({ request: values => new Promise(resolve => pending.push({ values, resolve })),
    saved: (id, data) => saved.push([id, data]), failed: error => failed.push(error) });
  const edit = { profile_id: "A", mounts: [{ marker_id: 0 }], marker_preference_s: 0 };
  const first = writer.save(edit);
  edit.profile_id = "B"; edit.mounts[0].marker_id = 9;
  const second = writer.save({ ...edit, marker_preference_s: 1.5 });
  await new Promise(setImmediate);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].values, { profile_id: "A", mounts: [{ marker_id: 0 }], marker_preference_s: 0 });
  pending[0].resolve(response({ marker_preference_s: 0 }));
  await first;
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  assert.equal(pending[1].values.profile_id, "B");
  pending[1].resolve({ ok: false, statusText: "Failed", json: async () => ({ detail: "disk full" }) });
  assert.equal(await second, null);
  assert.equal(failed.length, 1);
  const third = writer.save({ profile_id: "B", marker_preference_s: 1.5 });
  await new Promise(setImmediate);
  pending[2].resolve(response({ marker_preference_s: 1.5 }));
  await writer.flush();
  assert.deepEqual(saved, [["A", { marker_preference_s: 0 }], ["B", { marker_preference_s: 1.5 }]]);
  assert.equal(await third, await writer.flush());
});

for (const status of [409, 500]) test(`profile creation failure ${status} is bounded`, async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push(options?.method || "GET");
    return options ? { ok: false, status } : response({ profiles: [] });
  };
  await assert.rejects(profilesForRobot(request, "openyam", true), /Could not create/);
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("locked profile loads never create, and successful creation refreshes once", async () => {
  let count = 0;
  const request = async () => {
    count++;
    return response({ profiles: count < 3 ? [] : [{ id: "arm", robot: "openyam" }] });
  };
  assert.deepEqual(await profilesForRobot(request, "openyam", false), []);
  count = 0;
  assert.deepEqual(await profilesForRobot(request, "openyam", true), [{ id: "arm", robot: "openyam" }]);
  assert.equal(count, 3);
});

for (const phase of ["checking", "installing", "starting", "running", "stopping", "ready"]) {
  test(`derived controls for ${phase} preserve hardware gating and service independence`, () => {
    const facts = { status: { phase, check_ok: true }, manipulation: true, simulated: false,
      can: { ready: false }, planner: { ready: true }, settingUp: false };
    const physical = launcherPresentation(facts);
    assert.equal(physical.startDisabled, true);
    const simulated = launcherPresentation({ ...facts, simulated: true });
    assert.equal(simulated.startDisabled, phase !== "ready");
    assert.equal(simulated.locked, ["starting", "running", "stopping"].includes(phase));
    assert.equal(launcherPresentation({ ...facts, manipulation: false }).startDisabled, phase !== "ready");
  });
}

test("source request preserves explicit device and replay selection", () => {
  const value = sourceRequest({ selection: "device:can1", address: " 10.0.0.1 ", replay: " /record.db ",
    playback: "recording", streams: { camera: "front" } });
  assert.deepEqual(value, { mode: "device", device_id: "can1", address: "10.0.0.1", replay: "/record.db",
    playback: "recording", streams: { camera: "front" } });
});
