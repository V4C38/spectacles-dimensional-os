import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { catalog, applicableCases } from "./catalog.mjs";

export function sourceIdentity(cwd) {
  cwd = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const changes = execFileSync("git", ["diff", "HEAD", "--binary"], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  const hash = createHash("sha256").update(revision).update(changes);
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of untracked)
    hash.update(file).update(readFileSync(resolve(cwd, file)));
  return {
    revision,
    dirty: changes.length !== 0 || untracked.length > 0,
    fingerprint: hash.digest("hex"),
  };
}
export function runId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}
export async function documents(root, name) {
  const found = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (
      item.isDirectory() &&
      !["node_modules", "mcp", "source-audit-mcp"].includes(item.name)
    )
      found.push(...(await documents(path, name)));
    else if (item.name === name)
      found.push({
        directory: root,
        path,
        value: JSON.parse(await readFile(path, "utf8")),
      });
  }
  return found;
}
export function coverage(client, checks, scope = "all") {
  const required = applicableCases(client).filter(
    (row) => scope === "all" || (scope === "golden" ? row.video : !row.video),
  );
  return catalog.cases.map((row) => {
    if (!row.platforms.includes(client))
      return {
        id: row.id,
        status: "not-applicable",
        reason: `${row.platforms.join("/")} only`,
      };
    if (!required.some((test) => test.id === row.id))
      return { id: row.id, status: "not-run", reason: `${scope} scope` };
    const evidence = checks.filter((check) => check.caseId === row.id);
    const assertions = row.assertions.map((id) => ({
      id,
      passed: evidence.some(
        (check) => check.name === id && check.passed === true,
      ),
    }));
    return {
      id: row.id,
      status: evidence.some((check) => check.passed === false)
        ? "failed"
        : assertions.every((assertion) => assertion.passed)
          ? "passed"
          : "missing",
      assertions,
    };
  });
}
export async function numberImages(root, records) {
  let index = 0;
  const images = [];
  for (const record of records) {
    if (!record.source || !existsSync(record.source)) continue;
    const name = `${String(++index).padStart(2, "0")}_${record.id.replace(/[^a-z0-9_]/gi, "_")}.png`;
    const target = join(root, name);
    if (record.source.endsWith(".png")) {
      if (resolve(record.source) !== resolve(target))
        await copyFile(record.source, target);
    } else
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-i",
        record.source,
        "-frames:v",
        "1",
        target,
      ]);
    images.push({
      id: record.id,
      file: name,
      source: relative(root, record.source),
      ...record.metadata,
    });
  }
  return images;
}
export async function finishRun(root, client, options = {}) {
  root = resolve(root);
  await mkdir(root, { recursive: true });
  const suites = (await documents(root, "case-results.json")).concat(
    (await documents(root, "results.json")).filter(
      (row) => row.directory !== root,
    ),
  );
  const checks = (options.checks ?? []).concat(
    suites.flatMap((row) => [
      ...(row.value.checks ?? []),
      ...(row.value.passed === false ||
      row.value.runtimeErrors?.length ||
      ["failed", "timedOut", "interrupted"].includes(row.value.testStatus)
        ? [
            {
              caseId: "suite_failure",
              name: relative(root, row.path),
              passed: false,
              detail:
                row.value.error ??
                row.value.runtimeErrors ??
                row.value.testStatus,
            },
          ]
        : []),
    ]),
  );
  const cases = coverage(client, checks, options.scope ?? "all");
  const manifests = await documents(root, "review-scenes.json");
  const records = [];
  for (const row of catalog.cases.filter((row) =>
    row.platforms.includes(client),
  )) {
    for (const manifest of manifests)
      for (const scene of manifest.value.scenes ?? []) {
        if ((scene.id ?? scene.name) === row.id && scene.screenshot)
          records.push({
            id: row.id,
            source: resolve(manifest.directory, scene.screenshot),
            metadata: { suite: relative(root, manifest.directory) || "." },
          });
      }
  }
  // Supplemental existing regressions remain visible without being mistaken for catalog coverage.
  for (const suite of suites)
    for (const image of suite.value.images ?? [])
      records.push({
        id: image.id,
        source: resolve(suite.directory, image.file),
      });
  const images = await numberImages(root, records);
  for (const row of cases)
    if (row.status === "passed" && !images.some((image) => image.id === row.id))
      row.status = "missing-image";
  const result = {
    schemaVersion: catalog.schemaVersion,
    client,
    seed: catalog.fixtures.seed,
    source: options.source ?? sourceIdentity(root),
    scope: options.scope ?? "all",
    cases,
    checks,
    images,
    passed:
      cases.every(
        (row) => !["missing", "failed", "missing-image"].includes(row.status),
      ) && checks.every((row) => row.passed !== false),
    ...options.metadata,
  };
  await writeFile(
    join(root, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  return result;
}

/** Explicit post-verification cleanup; a failed or missing new run cannot erase evidence. */
export async function removeOldResults(root, keep) {
  const { rm } = await import("node:fs/promises");
  root = resolve(root);
  if (!root.endsWith("/integration-tests/test-results") || !keep.length)
    throw new Error("Unsafe integration cleanup root");
  for (const name of keep) {
    if (name.includes("/") || name.includes(".."))
      throw new Error("Unsafe run name");
    const result = JSON.parse(
      await readFile(join(root, name, "results.json"), "utf8"),
    );
    if (!result.passed || result.scope !== "all")
      throw new Error("Cleanup requires a completed passing full run");
  }
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory() && !keep.includes(entry.name))
      await rm(join(root, entry.name), { recursive: true });
}
