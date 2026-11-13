import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { checkProject } from "../../../../tools/architecture/check.mjs";

it("keeps Specs on packaged Core and free of browser SDKs, test fixtures and cycles", () => {
  const root = fileURLToPath(new URL("../../Assets/Scripts/DimOSSpecsClient/", import.meta.url));
  expect(checkProject(ts, root, "specs")).toEqual([]);
});
