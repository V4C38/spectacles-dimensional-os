import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const source = fileURLToPath(new URL("../src/", import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

it("keeps all Core module dependencies inside authored Core source", () => {
  for (const path of files(source)) {
    for (const dependency of ts.preProcessFile(readFileSync(path, "utf8")).importedFiles) {
      const label = `${relative(source, path)} imports ${dependency.fileName}`;
      expect(dependency.fileName.startsWith("."), label).toBe(true);
      const target = relative(source, resolve(dirname(path), dependency.fileName));
      expect(target === ".." || target.startsWith(".." + sep), label).toBe(false);
    }
  }
});
