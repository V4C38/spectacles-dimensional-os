import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runId,
  sourceIdentity,
  removeOldResults,
} from "../../../tools/integration-tests/artifacts.mjs";
import { finalize } from "../../../tools/integration-tests/finalize.mjs";
const client = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const executable of ["ffmpeg", "ffprobe"]) {
  if (spawnSync(executable, ["-version"]).status !== 0)
    throw new Error(
      `${executable} is required before running integration tests`,
    );
}
const output = join(client, "tests/integration-tests/test-results", runId());
await mkdir(output, { recursive: true });
const source = sourceIdentity(client);
await writeFile(
  join(output, "run.json"),
  JSON.stringify(
    { client: "webxr", source, startedAt: new Date().toISOString() },
    null,
    2,
  ),
);
const command = spawnSync(
  process.execPath,
  [
    join(client, "node_modules/@playwright/test/cli.js"),
    "test",
    ...process.argv.slice(2),
  ],
  {
    cwd: client,
    env: { ...process.env, INTEGRATION_RESULTS_DIR: output },
    stdio: "inherit",
  },
);
await writeFile(
  join(output, "case-results.json"),
  JSON.stringify({
    checks: [
      { caseId: "runner", name: "playwright", passed: command.status === 0 },
    ],
  }),
);
let passed = false;
try {
  passed = (await finalize(output, "webxr")).passed;
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ error: String(error) }),
  );
  console.error(error);
}
if (passed && command.status === 0)
  await removeOldResults(dirname(output), [basename(output)]);
console.log(`${passed && command.status === 0 ? "PASS" : "FAIL"}: ${output}`);
process.exitCode = passed && command.status === 0 ? 0 : 1;
