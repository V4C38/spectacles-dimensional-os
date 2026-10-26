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
  const expected = value.cases.filter((row) => row.video).map((row) => row.id);
  if (
    JSON.stringify(expected) !==
    JSON.stringify(value.golden.chapters.map((row) => row.id))
  )
    throw new Error("Golden chapters differ from catalog order");
  return true;
}
validateCatalog();
