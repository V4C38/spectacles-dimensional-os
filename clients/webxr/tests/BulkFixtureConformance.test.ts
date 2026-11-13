import { expect, it } from "vitest";
import { IntegrationV2Fixture } from "../../specs/Tests/integration-tests/IntegrationV2Fixture";
import { V2BulkPeer } from "./integration-tests/fixtures/V2BulkPeer";
import { runBulkContract, type BulkContractDriver } from "../../../tools/integration-tests/support/IntegrationBulkContract";
import { fixtureBinaryPackets, appendFixtureUpload, fixtureAsset } from "../../../tools/integration-tests/support/IntegrationBulk";

function nativeDriver(): BulkContractDriver {
  const controls: any[] = [], records: any[] = [], uploads: Uint8Array[] = [];
  const peer = new IntegrationV2Fixture(value => controls.push(value), "contract", () => 1);
  peer.bind({ onTransportText: (text: string) => records.push(JSON.parse(text)) } as never);
  peer.onUpload = bytes => uploads.push(bytes);
  return { controls, records, uploads, send: value => peer.send(value),
    text: value => peer.sendText(JSON.stringify(value)), binary: bytes => peer.sendBinary(bytes) };
}

async function browserDriver(): Promise<BulkContractDriver> {
  const controls: any[] = [], records: any[] = [], uploads: Uint8Array[] = [];
  let incoming!: (value: string | Buffer) => void;
  const peer = new V2BulkPeer();
  await peer.install({ routeWebSocket: async (_pattern: RegExp, attach: (socket: object) => void) => attach({
    onMessage: (callback: typeof incoming) => { incoming = callback; },
    send: (text: string) => records.push(JSON.parse(text)),
  }) } as never);
  const control = { send: (text: string) => controls.push(JSON.parse(text)) };
  peer.onUpload = bytes => uploads.push(bytes);
  return { controls, records, uploads, send: value => peer.send(control as never, value),
    text: value => incoming(JSON.stringify(value)), binary: bytes => incoming(Buffer.from(bytes)) };
}

it("native and browser transport wrappers honor the same upload and asset trace", async () => {
  const expected = { accepted: { type: "bulk_upload_result", upload_id: 7, status: "accepted" },
    rejected: { type: "bulk_upload_result", upload_id: 8, status: "rejected" }, uploaded: [255, 0, 17],
    inlinePlan: undefined, metadata: { plan_id: "checked", group_id: "arm", duration: 1 },
    points: [{ time: 0, positions: [0] }, { time: 1, positions: [.3] }] };
  expect(runBulkContract(nativeDriver())).toEqual(expected);
  expect(runBulkContract(await browserDriver())).toEqual(expected);
});

it("test wire builders reject wrong IDs, offsets and overruns and honor view offsets", () => {
  const bytes = new Uint8Array(20000).fill(17), packets = fixtureBinaryPackets(bytes, 42);
  const upload = { id: 42, bytes: new Uint8Array(bytes.length), offset: 0 };
  expect(packets.map(packet => packet.length)).toEqual([16384, 3640]);
  expect(appendFixtureUpload(upload, packets[0])).toBe(false);
  expect(() => appendFixtureUpload(upload, packets[0])).toThrow();
  expect(appendFixtureUpload(upload, packets[1])).toBe(true);
  expect(upload.bytes).toEqual(bytes);
  expect(() => appendFixtureUpload({ ...upload, offset: 0, id: 1 }, packets[0])).toThrow();
  expect(() => appendFixtureUpload({ ...upload, offset: 0, bytes: new Uint8Array(2) }, packets[0])).toThrow();
  const backing = new Uint8Array(packets[1].length + 20);
  backing.set(packets[1], 10);
  expect(appendFixtureUpload({ ...upload, offset: 16372 }, backing.subarray(10, -10))).toBe(true);
});


it("reuses cached asset identity without splitting unchanged trajectories again", () => {
  const value = { plan_id: "cached", trajectory: Array.from({ length: 100 }, (_, time) => ({ time, positions: [time] })) };
  let measured = 0;
  const policy = { maximumPartSize: 100, measure: (text: string) => { measured++; return text.length; } };
  const first = fixtureAsset("trajectory", value, policy);
  expect(first.records!.length).toBeGreaterThan(2);
  const before = measured;
  const hit = fixtureAsset("trajectory", value, policy, new Map([[first.ref.id, first.records]]));
  expect(hit.ref).toEqual(first.ref);
  expect(hit.records).toBeNull();
  expect(measured).toBe(before);
});
