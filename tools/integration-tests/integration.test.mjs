import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalog, applicableCases, validateCatalog } from "./catalog.mjs";
import { coverage, numberImages, finishRun } from "./artifacts.mjs";

test("catalog contains one unambiguous shared golden order and explicit platform exceptions", () => {
  assert.equal(validateCatalog(), true);
  assert.equal(
    applicableCases("webxr", "golden").length,
    applicableCases("specs", "golden").length,
  );
  assert.throws(
    () =>
      validateCatalog({
        ...catalog,
        cases: [...catalog.cases, catalog.cases[0]],
      }),
    /duplicate/,
  );
  assert.throws(() => applicableCases("controller"), /Unknown/);
});
test("missing or mislabeled assertions never become coverage", () => {
  const checks = [
    { caseId: "robot_hover", name: "robot_selected", passed: true },
  ];
  const rows = coverage("specs", checks);
  assert.equal(rows.find((row) => row.id === "robot_hover").status, "missing");
  assert.equal(
    rows.find((row) => row.id === "controller_input").status,
    "not-applicable",
  );
  assert.equal(
    coverage("specs", [
      { caseId: "robot_hover", name: "robot_hover", passed: false },
    ]).find((row) => row.id === "robot_hover").status,
    "failed",
  );
});
test("numbered images are consecutive and leave their native evidence intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "integration-images-"));
  try {
    const source = join(root, "native.png");
    await writeFile(source, "native bytes");
    const images = await numberImages(root, [
      { id: "setup_entry", source },
      { id: "robot_hover", source },
    ]);
    assert.deepEqual(
      images.map((row) => row.file),
      ["01_setup_entry.png", "02_robot_hover.png"],
    );
    assert.equal(await readFile(source, "utf8"), "native bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("golden-only results cannot imply regression completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "integration-coverage-"));
  try {
    const checks = applicableCases("webxr", "golden").map((row) => ({
      caseId: row.id,
      name: row.id,
      passed: true,
    }));
    const partial = await finishRun(root, "webxr", {
      checks,
      scope: "golden",
      source: {},
    });
    assert.equal(partial.passed, false);
    assert.equal(
      partial.cases.find((row) => row.id === "robot_hover").status,
      "missing-image",
    );
    assert.equal(
      partial.cases.find((row) => row.id === "connection_recovery").status,
      "not-run",
    );
    const all = await finishRun(root, "webxr", { checks, source: {} });
    assert.equal(all.passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("captured browser clock marker aligns media instead of guessing start time", async () => {
  const { alignRecording } = await import("./finalize.mjs");
  const { execFileSync, spawnSync } = await import("node:child_process");
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return;
  const root = await mkdtemp(join(tmpdir(), "integration-clock-"));
  try {
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=128x90:rate=25:duration=2",
      "-vf",
      "drawbox=x=0:y=0:w=12:h=12:color=magenta:t=fill:enable='between(t,0.5,0.8)'",
      "-y",
      join(root, "video.mp4"),
    ]);
    const manifest = {
      recording: "video.mp4",
      sync: { epochMs: 0 },
      scenes: [{ at: 0.5, durationS: 1, screenshotAt: 0.8 }],
    };
    alignRecording(root, manifest);
    assert.ok(Math.abs(manifest.sync.recordingOffsetS - 0.5) < 0.08);
    assert.ok(Math.abs(manifest.scenes[0].at - 1) < 0.08);
    alignRecording(root, manifest);
    assert.ok(Math.abs(manifest.scenes[0].at - 1) < 0.08);
    const missing = { recording: "video.mp4", sync: {}, scenes: [] };
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=128x90:duration=1",
      "-y",
      join(root, "video.mp4"),
    ]);
    assert.throws(() => alignRecording(root, missing), /clock marker/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native runtime failures survive aggregation even if individual assertions passed", async () => {
  const { mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "integration-native-error-"));
  try {
    const child = join(root, "native");
    await mkdir(child);
    await writeFile(
      join(child, "results.json"),
      JSON.stringify({
        passed: false,
        runtimeErrors: ["Native runtime error"],
        checks: [],
      }),
    );
    const result = await finishRun(root, "specs", {
      scope: "golden",
      source: {},
    });
    assert.equal(result.passed, false);
    assert.equal(
      result.checks.find((row) => row.caseId === "suite_failure").passed,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup requires verified complete results and retains the new run", async () => {
  const { mkdir, access } = await import("node:fs/promises");
  const { removeOldResults } = await import("./artifacts.mjs");
  const parent = await mkdtemp(join(tmpdir(), "integration-cleanup-")),
    root = join(parent, "integration-tests/test-results");
  try {
    await mkdir(join(root, "old"), { recursive: true });
    await mkdir(join(root, "new"));
    await writeFile(
      join(root, "new/results.json"),
      JSON.stringify({ passed: false, scope: "all" }),
    );
    await assert.rejects(removeOldResults(root, ["new"]), /passing full run/);
    await access(join(root, "old"));
    await writeFile(
      join(root, "new/results.json"),
      JSON.stringify({ passed: true, scope: "all" }),
    );
    await removeOldResults(root, ["new"]);
    await access(join(root, "new"));
    await assert.rejects(access(join(root, "old")));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
