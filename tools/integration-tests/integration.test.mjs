import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalog, applicableCases, goldenChapters, validateCatalog } from "./catalog.mjs";
import { coverage, numberImages, finishRun, reviewDataRoot, publishGoldenVideo } from "./artifacts.mjs";

test("each client has an explicit golden order including manipulation", () => {
  assert.equal(validateCatalog(), true);
  assert.equal(goldenChapters("specs").length, 15);
  assert.equal(goldenChapters("webxr").length, 15);
  for (const client of ["webxr", "specs"])
    assert.deepEqual(applicableCases(client, "golden").map(row => row.id), goldenChapters(client).map(row => row.id));
  const armIds = ["manipulation_select", "manipulation_preview", "manipulation_execute", "manipulation_following", "manipulation_controls"];
  assert.deepEqual(goldenChapters("webxr").slice(-5).map(row => row.id), armIds);
  assert.deepEqual(goldenChapters("specs").slice(-5).map(row => row.id), armIds);
  assert.throws(() => validateCatalog({ ...catalog, cases: [...catalog.cases, catalog.cases[0]] }), /duplicate/);
  assert.throws(() => validateCatalog({ ...catalog, golden: { ...catalog.golden, webxrChapters: catalog.golden.chapters.slice(0, -1) } }), /webxr catalog order/);
  assert.throws(() => applicableCases("controller"), /Unknown/);
});
test("arm chapters require their own assertions for both clients", () => {
  const missing = coverage("webxr", []);
  assert.equal(missing.find(row => row.id === "manipulation_execute").status, "missing");
  assert.equal(coverage("specs", []).find(row => row.id === "manipulation_execute").status, "missing");
  assert.equal(coverage("webxr", [{ caseId: "manipulation_execute", name: "manipulation_execute", passed: true }])
    .find(row => row.id === "manipulation_execute").status, "passed");
});
test("missing or mislabeled assertions never become coverage", () => {
  const checks = [
    { caseId: "robot_selected", name: "navigation_preview", passed: true },
  ];
  const rows = coverage("specs", checks);
  assert.equal(rows.find((row) => row.id === "robot_selected").status, "missing");
  assert.equal(
    rows.find((row) => row.id === "controller_input").status,
    "not-applicable",
  );
  assert.equal(
    coverage("specs", [
      { caseId: "robot_selected", name: "robot_selected", passed: false },
    ]).find((row) => row.id === "robot_selected").status,
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
      { id: "robot_selected", source },
    ]);
    assert.deepEqual(
      images.map((row) => row.file),
      ["01_setup_entry.png", "02_robot_selected.png"],
    );
    assert.equal(await readFile(source, "utf8"), "native bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("golden-only results cannot imply regression completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "integration-coverage-"));
  try {
    const checks = applicableCases("specs", "golden").map((row) => ({
      caseId: row.id,
      name: row.id,
      passed: true,
    }));
    const partial = await finishRun(root, "specs", {
      checks,
      scope: "golden",
      source: {},
    });
    assert.equal(partial.passed, false);
    assert.equal(
      partial.cases.find((row) => row.id === "robot_selected").status,
      "missing-image",
    );
    assert.equal(
      partial.cases.find((row) => row.id === "connection_recovery").status,
      "not-run",
    );
    const all = await finishRun(root, "specs", { checks, source: {} });
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

test("cleanup requires a full pass and retains failed, partial and unclassified evidence", async () => {
  const { mkdir, access } = await import("node:fs/promises");
  const { removeOldResults } = await import("./artifacts.mjs");
  const parent = await mkdtemp(join(tmpdir(), "integration-cleanup-")),
    root = join(parent, "integration-tests/test-results");
  try {
    await mkdir(join(root, "old"), { recursive: true });
    await writeFile(join(root, "old/results.json"), JSON.stringify({ passed: true, scope: "all" }));
    for (const [name, result] of [["failed", { passed: false, scope: "all" }], ["partial", { passed: true, scope: "golden" }], ["unknown", null]]) {
      await mkdir(join(root, name));
      if (result) await writeFile(join(root, name, "results.json"), JSON.stringify(result));
    }
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
    for (const name of ["failed", "partial", "unknown"]) await access(join(root, name));
    await assert.rejects(removeOldResults(parent, ["new"]), /Unsafe integration cleanup root/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("finalization preserves startup provenance and rejects a changed source", async () => {
  const { finalize } = await import("./finalize.mjs");
  const { sourceIdentity } = await import("./artifacts.mjs");
  const { mkdir } = await import("node:fs/promises");
  const parent = join(reviewDataRoot, "unit/integration-tooling");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "provenance-"));
  try {
    const initial = { ...sourceIdentity(root), fingerprint: "different-startup-source" };
    await writeFile(join(root, "run.json"), JSON.stringify({ source: initial }));
    const result = await finalize(root, "webxr", "golden");
    assert.deepEqual(result.source, initial);
    assert.equal(result.checks.find(row => row.name === "source_unchanged").passed, false);
    assert.equal(result.passed, false);
    assert.notEqual(result.finalSource.fingerprint, initial.fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit output paths outside the checkout retain source provenance", async () => {
  const { finalize } = await import("./finalize.mjs");
  const { sourceIdentity } = await import("./artifacts.mjs");
  const root = await mkdtemp(join(tmpdir(), "integration external evidence "));
  try {
    const source = sourceIdentity();
    await writeFile(join(root, "run.json"), JSON.stringify({ source }));
    const result = await finalize(root, "webxr", "regression");
    assert.deepEqual(result.source, source);
    assert.equal(result.checks.find(row => row.name === "source_unchanged").passed, true);
    assert.equal(result.passed, false); // Missing real case evidence still fails.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("latest client golden videos replace atomically after complete verification", async () => {
  const { mkdir, access, readdir } = await import("node:fs/promises");
  const { sourceIdentity } = await import("./artifacts.mjs");
  const parent = await mkdtemp(join(tmpdir(), "golden publication with spaces "));
  const output = join(parent, "Review Data"), run = join(parent, "run evidence");
  const result = {
    client: "webxr", passed: true, scope: "all", source: sourceIdentity(),
    checks: ["golden_video_present", "source_unchanged"].map((name) => ({ name, passed: true })),
  };
  try {
    await mkdir(run);
    await mkdir(output);
    await writeFile(join(output, "webxr_golden-path.mp4"), "previous webxr");
    await writeFile(join(output, "specs_golden-path.mp4"), "previous specs");
    await writeFile(join(output, "webxr-golden-path.mp4"), "legacy spelling");
    await writeFile(join(output, "webxr_golden-path-2026-11-09T10-00-00Z.mp4"), "legacy date");
    await writeFile(join(output, "webxr_other-video.mp4"), "user export");
    await writeFile(join(run, "results.json"), JSON.stringify(result));
    // A missing replacement must leave the prior successful video untouched.
    await assert.rejects(publishGoldenVideo(run, "webxr", output), { code: "ENOENT" });
    assert.equal(await readFile(join(output, "webxr_golden-path.mp4"), "utf8"), "previous webxr");
    await writeFile(join(run, "golden-path.mp4"), "verified new webxr");
    assert.equal(await publishGoldenVideo(run, "webxr", output), join(output, "webxr_golden-path.mp4"));
    assert.equal(await readFile(join(output, "webxr_golden-path.mp4"), "utf8"), "verified new webxr");
    assert.equal(await readFile(join(output, "specs_golden-path.mp4"), "utf8"), "previous specs");
    await access(join(output, "webxr_other-video.mp4"));
    await assert.rejects(access(join(output, "webxr-golden-path.mp4")));
    await assert.rejects(access(join(output, "webxr_golden-path-2026-11-09T10-00-00Z.mp4")));
    assert.equal((await readdir(output)).some((name) => name.startsWith(".webxr-golden-")), false);

    for (const changed of [{ passed: false }, { scope: "regression" }, { checks: [] }]) {
      await writeFile(join(run, "results.json"), JSON.stringify({ ...result, ...changed }));
      await writeFile(join(run, "golden-path.mp4"), "unverified replacement");
      assert.equal(await publishGoldenVideo(run, "webxr", output), null);
      assert.equal(await readFile(join(output, "webxr_golden-path.mp4"), "utf8"), "verified new webxr");
    }

    const native = { ...result, client: "specs", scope: "golden", sourceAuditState: "pending" };
    await writeFile(join(run, "results.json"), JSON.stringify(native));
    assert.equal(await publishGoldenVideo(run, "specs", output), null);
    assert.equal(await readFile(join(output, "specs_golden-path.mp4"), "utf8"), "previous specs");
    native.sourceAuditState = "passed";
    native.checks = [...native.checks, { name: "source_editor_clean", passed: true }];
    await writeFile(join(run, "results.json"), JSON.stringify(native));
    await writeFile(join(run, "golden-path.mp4"), "verified complete native golden");
    await publishGoldenVideo(run, "specs", output);
    assert.equal(await readFile(join(output, "specs_golden-path.mp4"), "utf8"), "verified complete native golden");
    assert.equal(await readFile(join(output, "webxr_golden-path.mp4"), "utf8"), "verified new webxr");
    // A handoff/encoding-time change invalidates an earlier passing source check.
    await writeFile(join(run, "results.json"), JSON.stringify({ ...native, source: { ...native.source, fingerprint: "source-before-handoff" } }));
    await writeFile(join(run, "golden-path.mp4"), "stale source video");
    await assert.rejects(publishGoldenVideo(run, "specs", output), /Source changed before golden publication/);
    assert.equal(await readFile(join(output, "specs_golden-path.mp4"), "utf8"), "verified complete native golden");
    const rejected = JSON.parse(await readFile(join(run, "results.json"), "utf8"));
    assert.equal(rejected.passed, false);
    assert.equal(rejected.checks.find((row) => row.name === "publication_source_unchanged").passed, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
