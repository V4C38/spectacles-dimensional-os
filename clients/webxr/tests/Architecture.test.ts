import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));
const core = fileURLToPath(new URL("../../specs/Assets/Scripts/DimOSARClient", import.meta.url));
function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}
function imports(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
}

it("keeps ClientCore independent of both headset hosts and vendor packages", () => {
  const violations: string[] = [];
  for (const file of sources(core)) {
    for (const dependency of imports(file)) {
      if (!dependency.startsWith(".") || !resolve(dirname(file), dependency).startsWith(core + sep)) violations.push(`${relative(core, file)} → ${dependency}`);
    }
    if (/\b(?:window|document|navigator)\./.test(readFileSync(file, "utf8"))) violations.push(`${relative(core, file)} uses a platform global`);
  }
  expect(violations).toEqual([]);
});

it("keeps localization, sensor rendering and speech adapters independent of unrelated host features", () => {
  const forbidden: Record<string, string[]> = {
    localization: ["presentation", "navigation", "sensors", "agent"],
    sensors: ["presentation", "localization", "navigation", "agent"],
    agent: ["presentation", "localization", "navigation", "sensors"],
  };
  const violations: string[] = [];
  for (const [domain, excluded] of Object.entries(forbidden)) {
    for (const file of sources(join(src, domain))) {
      for (const dependency of imports(file).filter(value => value.startsWith("."))) {
        const target = relative(src, resolve(dirname(file), dependency)).split(sep)[0];
        if (excluded.includes(target)) violations.push(`${relative(src, file)} → ${dependency}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
