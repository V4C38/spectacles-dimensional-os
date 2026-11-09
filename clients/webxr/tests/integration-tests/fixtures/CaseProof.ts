import { writeFile, readdir, mkdir } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
/** Call only after the containing integration test has run all its assertions. */
export async function saveCaseProof(
  info: TestInfo,
  caseImages: Record<string, string> = {},
  assertions: Record<string, string[]> = {},
) {
  await mkdir(info.outputDir, { recursive: true });
  const images = (await readdir(info.outputDir)).filter(file => file.endsWith(".png")).sort();
  const ids = Object.keys(caseImages);
  if (info.status === "passed") {
    for (const [id, file] of Object.entries(caseImages)) {
      if (!images.includes(file)) throw new Error(`Missing explicit image for ${id}: ${file}`);
    }
  }
  await writeFile(
    info.outputPath("case-results.json"),
    JSON.stringify(
      {
        checks: ids.flatMap((id) => (assertions[id] ?? [id]).map(name => ({
          caseId: id,
          name,
          passed: info.status === "passed",
        }))),
        images: [
          ...ids.filter(id => images.includes(caseImages[id])).map(id => ({ id, file: caseImages[id] })),
          ...images.filter(file => !Object.values(caseImages).includes(file)).map((file) => ({
            id: file.replace(/\.png$/, "").replace(/-/g, "_"),
            file,
          })),
        ],
      },
      null,
      2,
    ),
  );
}
