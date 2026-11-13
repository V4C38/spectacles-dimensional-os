import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const emptyIdentity = "00000000-0000-0000-0000-000000000000";

/** Definitions create import identities; own/reference values merely link to them. */
export function metadataDefinitions(source) {
  const definitions = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const tags = [...line.matchAll(new RegExp(`!<([^>/\\s]+)/(${uuid})>`, "gi"))]
      .map(match => ({ kind: match[1], id: match[2] }));
    const primary = line.match(new RegExp(`^\\s*PrimaryAsset:\\s*!<reference>\\s*(${uuid})\\s*$`, "i"));
    const component = line.match(new RegExp(`^\\s*ComponentUid:\\s*(${uuid})\\s*$`, "i"));
    if (primary) tags.push({ kind: "PrimaryAsset", id: primary[1] });
    if (component) tags.push({ kind: "ComponentUid", id: component[1] });
    for (const definition of tags) {
      const id = definition.id.toLowerCase();
      if (id !== emptyIdentity) definitions.push({ ...definition, id, line: index + 1 });
    }
  }
  return definitions;
}

export function metadataIdentityConflicts(files) {
  const seen = new Map();
  const conflicts = [];
  for (const { path, source } of files) {
    for (const definition of metadataDefinitions(source)) {
      const location = `${path}:${definition.line} (${definition.kind})`;
      const previous = seen.get(definition.id);
      if (previous) conflicts.push(`${location} duplicates ${previous}: ${definition.id}`);
      else seen.set(definition.id, location);
    }
  }
  return conflicts;
}

/** Audit authored trees together, never an extracted archive that repeats their identities. */
export function checkMetadataRoots(roots) {
  const files = [];
  const missing = [];
  const visit = directory => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".meta")) files.push({ path, source: readFileSync(path, "utf8") });
      else if (entry.name.endsWith(".ts") && !names.has(entry.name + ".meta")) {
        missing.push(`${path} has no import metadata`);
      }
    }
  };
  for (const root of roots) visit(root);
  return [...missing, ...metadataIdentityConflicts(files)];
}
