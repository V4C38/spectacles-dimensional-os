import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

it("keeps Lens import identities unique and assigns metadata to every script", () => {
  const root = fileURLToPath(new URL("../../Assets", import.meta.url));
  const identities = new Map<string, string>();
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (entry.name.endsWith(".ts")) expect(() => readFileSync(path + ".meta")).not.toThrow();
      if (!entry.name.endsWith(".meta")) continue;
      const identity = readFileSync(path, "utf8").match(/AssetImportMetadata\/([\da-f-]+)/)?.[1];
      if (!identity) continue;
      expect(identities.get(identity), `${path} duplicates ${identities.get(identity)}`).toBeUndefined();
      identities.set(identity, path);
    }
  };
  walk(root);
});

it("binds the laser material to the actual imported shader identity", () => {
  const materials = fileURLToPath(new URL("../../Assets/Materials/", import.meta.url));
  const material = readFileSync(join(materials, "BendyLaser.mat"), "utf8");
  const shader = readFileSync(join(materials, "Shaders/BendyLaser.ss_graph.meta"), "utf8");
  const passId = material.match(/Pass: !<reference> ([\da-f-]+)/)?.[1];
  const shaderId = shader.match(/PrimaryAsset: !<reference> ([\da-f-]+)/)?.[1];
  expect(passId).toBeTruthy(); expect(passId).toBe(shaderId);
});
