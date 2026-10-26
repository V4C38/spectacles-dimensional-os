import { writeFile, readdir, mkdir } from "node:fs/promises";
import type { TestInfo } from "@playwright/test";
/** Call only after the containing integration test has run all its assertions. */
export async function saveCaseProof(
  info: TestInfo,
  ids: string[],
  images: string[] = [],
) {
  await mkdir(info.outputDir, { recursive: true });
  if (!images.length)
    images = (await readdir(info.outputDir))
      .filter((file) => file.endsWith(".png"))
      .sort();
  await writeFile(
    info.outputPath("case-results.json"),
    JSON.stringify(
      {
        checks: ids.map((id) => ({
          caseId: id,
          name: id,
          passed: info.status === "passed",
        })),
        images: [
          ...ids.flatMap((id) =>
            images.length
              ? [
                  {
                    id,
                    file: images.find((file) => file.includes(id)) ?? images[0],
                  },
                ]
              : [],
          ),
          ...images.map((file) => ({
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
