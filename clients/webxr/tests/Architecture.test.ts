import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { checkProject } from "../../../tools/architecture/check.mjs";

it("keeps WebXR production imports inside the host and free of unrelated features and cycles", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  expect(checkProject(ts, root, "webxr")).toEqual([]);
});
