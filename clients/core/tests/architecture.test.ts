import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { checkProject, dependencies, importViolation, runtimeCycles } from "../../../tools/architecture/check.mjs";

const root = fileURLToPath(new URL("../src/", import.meta.url));

it("keeps Core portable and free of runtime import cycles", () => {
  expect(checkProject(ts, root, "core")).toEqual([]);
});

it("finds every import form without matching comments or string examples", () => {
  const source = `
    import { Host } from "../Host";
    export type { Native } from "LensStudio:Native";
    const renderer = import("three");
    type Mesh = import("three").Mesh;
    const input = require("xrblocks");
    import Alias = require("sdk");
    import { type Vec3 } from "./ClientContracts";
    export { type Pose } from "./ClientContracts";
    // import { NotCode } from "three";
    const example = 'require("three")';
  `;
  expect(dependencies(ts, "example.ts", source)).toEqual([
    { specifier: "../Host", runtime: true }, { specifier: "LensStudio:Native", runtime: false },
    { specifier: "three", runtime: true }, { specifier: "three", runtime: false },
    { specifier: "xrblocks", runtime: true }, { specifier: "sdk", runtime: true },
    { specifier: "./ClientContracts", runtime: false }, { specifier: "./ClientContracts", runtime: false },
  ]);
});

it("rejects escaping paths, raw Specs Core imports, test fixtures and wrong SDKs", () => {
  const file = root + "agent/example.ts";
  const violation = (kind: string, specifier: string, runtime = true) =>
    importViolation(kind, file, root, { specifier, runtime });
  expect(violation("core", "../../host")).toBeTruthy();
  expect(violation("core", "@scope/sdk")).toBeTruthy();
  expect(violation("core", "../ClientContracts")).toBeNull();
  expect(violation("specs", "@dimos-ar-client/ClientContracts")).toBeTruthy();
  expect(violation("webxr", "LensStudio:Native")).toBeTruthy();
  expect(violation("webxr", "../../Tests/Fixture")).toBeTruthy();
  expect(violation("webxr", "../presentation/Menu")).toBeTruthy();
  expect(violation("specs", "../presentation/UIPresentationState", false)).toBeNull();
});

it("detects runtime cycles but permits repeated shared dependencies", () => {
  expect(runtimeCycles(new Map([["A", ["B"]], ["B", ["C"]], ["C", ["A"]]]))).toEqual([["A", "B", "C", "A"]]);
  expect(runtimeCycles(new Map([["A", ["B", "C"]], ["B", ["C"]], ["C", []]]))).toEqual([]);
});
