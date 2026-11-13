/** Scripted peer traffic: transport wrappers execute the same independent expectations. */
export type BulkContractDriver = {
  send(message: object): void;
  text(message: object): void;
  binary(packet: Uint8Array): void;
  controls: Record<string, any>[];
  records: Record<string, any>[];
  uploads: Uint8Array[];
};

export function runBulkContract(driver: BulkContractDriver) {
  const payload = new Uint8Array([255, 0, 17]);
  // Deliberately independent packet bytes instead of the shared packet builder.
  const packet = new Uint8Array([65, 82, 66, 50, 7, 0, 0, 0, 0, 0, 0, 0, ...payload]);
  driver.text({ type: "bulk_hello_request" });
  driver.send({ type: "localization_observations_request", purpose: "map" });
  const captureId = driver.controls.at(-1)!.capture_id;
  driver.text({ type: "bulk_upload_begin", upload_id: 7, capture_id: captureId, total_bytes: 3 });
  driver.binary(packet);
  const accepted = driver.records.at(-1);
  driver.text({ type: "bulk_upload_begin", upload_id: 8, capture_id: "retired", total_bytes: 3 });
  const rejected = driver.records.at(-1);
  driver.send({ type: "manipulation_state", plan: { plan_id: "checked", group_id: "arm", duration: 1,
    trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [.3] }] } });
  const control = driver.controls.at(-1)!;
  const parts = driver.records.filter(row => row.type === "bulk_record" && row.id === control.plan_ref.id);
  return { accepted, rejected, uploaded: [...driver.uploads[0]],
    inlinePlan: control.plan, metadata: parts[0].data.metadata,
    points: parts.flatMap(part => part.data.points ?? []) };
}
