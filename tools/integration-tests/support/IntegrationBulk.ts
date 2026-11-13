/** Test-only v2 wire builders. No host SDK, Node, or production state owners. */
export type FixtureValue = Record<string, any>;
export type FixtureUpload = { id: number; bytes: Uint8Array; offset: number; captureId?: string };

export function appendFixtureUpload(upload: FixtureUpload | null, packet: Uint8Array): boolean {
  if (!upload || packet.length < 12) throw new Error("Invalid fixture upload");
  const header = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (header.getUint32(0, true) !== 0x32425241 || header.getUint32(4, true) !== upload.id ||
      header.getUint32(8, true) !== upload.offset || upload.offset + packet.length - 12 > upload.bytes.length)
    throw new Error("Invalid fixture upload");
  upload.bytes.set(packet.subarray(12), upload.offset);
  upload.offset += packet.length - 12;
  return upload.offset === upload.bytes.length;
}

export function fixtureBinaryPackets(bytes: Uint8Array, id = 1): Uint8Array[] {
  const packets: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16372) {
    const payload = bytes.subarray(offset, offset + 16372);
    const packet = new Uint8Array(payload.length + 12), header = new DataView(packet.buffer);
    header.setUint32(0, 0x32425241, true);
    header.setUint32(4, id, true);
    header.setUint32(8, offset, true);
    packet.set(payload, 12);
    packets.push(packet);
  }
  return packets;
}

export function fixtureAsset(kind: string, value: FixtureValue,
  policy: { maximumPartSize: number; measure: (text: string) => number },
  existing?: { has(id: string): boolean }) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  const id = `${kind}-${hash >>> 0}`;
  const ref = { epoch: "fixture-epoch", id, revision: String(hash >>> 0) };
  if (existing?.has(id)) return { ref, records: null };
  const metadata = { ...value };
  const fields = kind === "model" ? ["links", "joints"] : [kind === "route" ? "path_poses" : "trajectory"];
  fields.forEach(field => delete metadata[field]);
  const pieces: FixtureValue[] = [{ metadata }];
  for (const field of fields) {
    const key = field === "links" || field === "joints" ? field : "points";
    let items: unknown[] = [];
    for (const item of value[field] ?? []) {
      if (items.length && policy.measure(JSON.stringify({ [key]: [...items, item] })) > policy.maximumPartSize) {
        pieces.push({ [key]: items }); items = [];
      }
      items.push(item);
    }
    if (items.length) pieces.push({ [key]: items });
  }
  return { ref, records: pieces.map((data, part) => ({ type: "bulk_record", ...ref, kind,
    part, parts: pieces.length, data })) };
}
