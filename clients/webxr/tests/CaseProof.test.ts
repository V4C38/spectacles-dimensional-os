import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { TestInfo } from "@playwright/test";
import { saveCaseProof } from "./integration-tests/fixtures/CaseProof";

it("requires an explicitly mapped image instead of borrowing an unrelated screenshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dimos-case-proof-"));
  const info = { outputDir: directory, outputPath: (name: string) => join(directory, name), status: "passed" } as TestInfo;
  try {
    await writeFile(join(directory, "unrelated.png"), "fixture");
    await expect(saveCaseProof(info, { robot_hover: "robot-hover.png" })).rejects.toThrow("Missing explicit image");
    await writeFile(join(directory, "robot-hover.png"), "fixture");
    await saveCaseProof(info, { robot_hover: "robot-hover.png" });
    const result = JSON.parse(await readFile(join(directory, "case-results.json"), "utf8"));
    expect(result.images.find((image: { id: string }) => image.id === "robot_hover").file).toBe("robot-hover.png");
    expect(result.images.filter((image: { id: string }) => image.id === "robot_hover")).toHaveLength(1);
    expect(result.checks).toEqual([{ caseId: "robot_hover", name: "robot_hover", passed: true }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
