import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const core = fileURLToPath(new URL("../../Assets/Scripts/DimOSARClient/", import.meta.url));
const futureCore = fileURLToPath(new URL("../../../core/", import.meta.url));
const platformPackages = ["three", "three-mesh-bvh", "xrblocks", "iwer", "@types/three"];

function imports(file: string, source: string): string[] {
  const result: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) result.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      add(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}

function violations(file: string, source: string): string[] {
  return imports(file, source).filter(specifier => {
    if (specifier.startsWith(".")) {
      const target = relative(core, resolve(dirname(file), specifier));
      return target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target);
    }
    return specifier.startsWith("LensStudio:") || /\.lspkg(?:\/|$)/.test(specifier) ||
      platformPackages.some(name => specifier === name || specifier.startsWith(name + "/"));
  });
}

function scripts(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? scripts(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

it("keeps portable ClientCore imports inside its source boundary and independent of host SDKs", () => {
  const failures = scripts(core).flatMap(file => violations(file, readFileSync(file, "utf8"))
    .map(specifier => `${relative(core, file)} imports ${specifier}`));
  expect(failures).toEqual([]);
});

it("detects static, re-exported, runtime and type dependencies without matching prose", () => {
  const source = `
    import { Host } from "../DimOSSpecsClient/Host";
    export type { Native } from "LensStudio:Native";
    const renderer = import("three");
    type Mesh = import("three").Mesh;
    const input = require("xrblocks");
    import type { Portable } from "./websocket/protocolTypes";
    // import { NotCode } from "three";
    const example = 'require("three")';
  `;
  expect(violations(join(core, "example.ts"), source)).toEqual([
    "../DimOSSpecsClient/Host", "LensStudio:Native", "three", "three", "xrblocks",
  ]);
});

it("keeps the future ClientCore package directory empty until the package split", () => {
  expect(readdirSync(futureCore).filter(name => name !== ".gitkeep" && name !== ".DS_Store")).toEqual([]);
});
