import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkMetadataRoots } from "../../../../tools/architecture/metadata.mjs";

it("keeps every defining Lens identity unique and assigns metadata to every script", () => {
  const root = fileURLToPath(new URL("../../Assets", import.meta.url));
  const authoredCore = fileURLToPath(new URL("../../../core/src/", import.meta.url));
  expect(checkMetadataRoots([root, authoredCore])).toEqual([]);
});

it("binds the laser material to the actual imported shader identity", () => {
  const materials = fileURLToPath(new URL("../../Assets/Materials/", import.meta.url));
  const material = readFileSync(join(materials, "BendyLaser.mat"), "utf8");
  const shader = readFileSync(join(materials, "Shaders/BendyLaser.ss_graph.meta"), "utf8");
  const passId = material.match(/Pass: !<reference> ([\da-f-]+)/)?.[1];
  const shaderId = shader.match(/PrimaryAsset: !<reference> ([\da-f-]+)/)?.[1];
  expect(passId).toBeTruthy(); expect(passId).toBe(shaderId);
});
