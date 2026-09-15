import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SPECS_ROOT = join(TESTS_DIR, "..");
const SCRIPTS_DIR = join(SPECS_ROOT, "Assets", "Scripts");
const SCENE_PATH = join(SPECS_ROOT, "Assets", "Scene.scene");
const THIS_FILE = relative(SPECS_ROOT, fileURLToPath(import.meta.url));

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "bridge", pattern: /bridge/i },
  { name: "SpectaclesHost", pattern: /SpectaclesHost/ },
  { name: "ar_go2", pattern: /ar_go2/ },
];

function walkFiles(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkFiles(full, acc);
      continue;
    }
    if (stat.isFile() && full.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function scan(path: string, contents: string): string[] {
  const hits: string[] = [];
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(contents)) {
      hits.push(rule.name);
    }
  }
  return hits;
}

describe("forbidden terms", () => {
  it("keeps scripts and Scene.scene free of bridge/SpectaclesHost/ar_go2", () => {
    const files = [SCENE_PATH, ...walkFiles(SCRIPTS_DIR, [])];
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(SPECS_ROOT, file);
      if (rel === THIS_FILE) {
        continue;
      }
      const hits = scan(file, readFileSync(file, "utf8"));
      if (hits.length > 0) {
        violations.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
