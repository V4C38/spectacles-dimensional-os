import { readFileSync } from "node:fs";
export const catalog = JSON.parse(
  readFileSync(new URL("./scenarios.json", import.meta.url), "utf8"),
);
export function applicableCases(client, group) {
  if (!["webxr", "specs"].includes(client))
    throw new Error(`Unknown integration client: ${client}`);
  return catalog.cases.filter(
    (row) => row.platforms.includes(client) && (!group || row.group === group),
  );
}
/** Both clients share the compact golden order; host-specific holds preserve complete gestures. */
export function goldenChapters(client, value = catalog) {
  if (!["webxr", "specs"].includes(client)) throw new Error(`Unknown integration client: ${client}`);
  return client === "webxr" ? value.golden.webxrChapters : value.golden.chapters;
}
export function validateCatalog(value = catalog) {
  if (value.schemaVersion !== 1)
    throw new Error("Unsupported integration catalog version");
  const ids = new Set();
  for (const row of value.cases) {
    if (!/^[a-z][a-z0-9_]+$/.test(row.id) || ids.has(row.id))
      throw new Error(`Invalid or duplicate case: ${row.id}`);
    if (
      !row.platforms.length ||
      row.platforms.some((client) => !["webxr", "specs"].includes(client))
    )
      throw new Error(`Invalid platforms: ${row.id}`);
    if (!row.assertions?.length)
      throw new Error(`Missing assertions: ${row.id}`);
    ids.add(row.id);
  }
  for (const client of ["webxr", "specs"]) {
    const expected = value.cases.filter(row => row.video && row.platforms.includes(client)).map(row => row.id);
    const chapters = goldenChapters(client, value);
    if (JSON.stringify(expected) !== JSON.stringify(chapters.map(row => row.id)))
      throw new Error(`Golden chapters differ from ${client} catalog order`);
    if (chapters.some(row => !Number.isFinite(row.durationS) || row.durationS <= 0))
      throw new Error(`Invalid ${client} golden chapter duration`);
  }
  return true;
}
validateCatalog();
