import { expect, it } from "vitest";
import { PresenceController, decodePresenceState } from "../../src/replication/PresenceController";
import { ClientTrackingOriginStore } from "../../src/localization/ClientTracking";
import type { PresenceCues, PresenceState } from "../../src/ClientContracts";
import { decodeOutbound } from "../../src/websocket/protocol";
const context = { map_code: "office", odom_reference_id: "odom" };
const cues = (x = 1): PresenceCues => ({ pointers: [{ id: 0, start: [0,0,0], control: [x/2,0,0], end: [x,0,0], opacity: .4, cursor: true }],
  panel: { position: [1,2,3], orientation: [0,0,0,1], width: .5, height: .3 } });
function fixture() {
  const origins = new ClientTrackingOriginStore(); origins.setMapContext(context);
  origins.setFromLocalizationResult({ type: "localization_result", position: [10,0,0], orientation: [0,0,0,1], confidence: 1, ts: 0 });
  const clock = { now: 0, ready: true }, sent: string[] = [];
  const core = new PresenceController({ ready: () => clock.ready, now: () => clock.now, clientId: () => "self", send: t => sent.push(t) }, origins);
  const state = (x = 1, age_s = 0): PresenceState => ({ type: "presence_state", ...context, clients: [{ client_id: "peer", age_s, ...cues(x) }] });
  return { core, origins, clock, sent, state };
}
it("caps moving cues at five samples/sec and refreshes stationary cues at one/sec", () => {
  const f = fixture(); let sampled = 0;
  for (let i = 0; i < 120; i++) { f.clock.now = i / 60; f.core.publish(() => { sampled++; return cues(); }); }
  expect(sampled).toBe(10); expect(f.sent).toHaveLength(2);
  expect(JSON.parse(f.sent[0]).pointers[0].end).toEqual([11,0,0]);
  f.clock.now = 2; f.core.publish(() => cues(2)); expect(f.sent).toHaveLength(3);
  f.clock.now = 2.1; f.core.publish(() => cues(3)); expect(f.sent).toHaveLength(3);
  f.clock.now = 2.2; f.core.publish(() => cues(3)); expect(f.sent).toHaveLength(4);
  expect(f.sent.every(t => new TextEncoder().encode(t).length < 600)).toBe(true);
});
it("sends one clear on suspension and no repeated hidden-state traffic", () => {
  const f = fixture(); f.core.publish(() => cues()); f.clock.now = .2; f.core.publish(() => cues(), false);
  f.clock.now = 3; f.core.publish(() => cues(), false);
  expect(f.sent).toHaveLength(2); expect(JSON.parse(f.sent[1])).toMatchObject({ pointers: [], panel: null });
  f.clock.ready = false; f.clock.now = 4; f.core.publish(() => cues()); expect(f.sent).toHaveLength(2);
});
it("interpolates in odom then projects using the current origin and removes hidden pointers immediately", () => {
  const f = fixture(); f.core.apply(f.state(10)); expect(f.core.snapshot()[0].cues.pointers[0].end[0]).toBe(0);
  f.clock.now = .2; f.core.apply(f.state(12)); f.clock.now = .3;
  expect(f.core.snapshot()[0].cues.pointers[0].end[0]).toBeCloseTo(1);
  const hidden = f.state(); hidden.clients[0].pointers = []; hidden.clients[0].panel = null;
  f.core.apply(hidden); expect(f.core.snapshot()[0].cues).toEqual({ pointers: [], panel: null });
  f.core.apply({ ...hidden, clients: [] }); expect(f.core.snapshot()).toEqual([]);
});
it("uses source age rather than aggregate refresh time, filters self and clears across context/reconnect", () => {
  const f = fixture(); const state = f.state(10, 1.8); state.clients.push({ ...state.clients[0], client_id: "self" });
  f.core.apply(state); expect(f.core.snapshot()).toHaveLength(1);
  f.clock.now = .21; expect(f.core.snapshot()).toEqual([]);
  f.core.apply(f.state()); f.origins.setMapContext({ ...context, map_code: "other" }); expect(f.core.snapshot()).toEqual([]);
  f.core.reset(); expect(f.core.snapshot()).toEqual([]);
});
it("strictly decodes optional cues and rejects malformed arrays, dimensions, quaternions and identities", () => {
  const f = fixture(); expect(decodeOutbound(JSON.stringify(f.state()))).toEqual(f.state());
  const bad: any[] = [ { ...f.state(), clients: Array(17).fill(f.state().clients[0]) },
    { ...f.state(), clients: [{ ...f.state().clients[0], pointers: [cues().pointers[0], cues().pointers[0]] }] } ];
  for (const width of [0, 11, NaN]) bad.push({ ...f.state(), clients: [{ ...f.state().clients[0], panel: { ...cues().panel, width } }] });
  bad.push({ ...f.state(), clients: [{ ...f.state().clients[0], panel: { ...cues().panel, orientation: [0,0,0,0] } }] });
  for (const state of bad) expect(() => decodePresenceState(state)).toThrow();
});
