import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { makeVisualReviews } from "./visual-review.mjs";

const encoderAvailable = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
test("assembles actual continuous recordings at their original playback speed", { skip: !encoderAvailable }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dimos-review-"));
  try {
    const directory = join(root, "SpecsReview-fixture"); await mkdir(directory);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=20:duration=5", "-c:v", "libx264", join(directory, "recording.mp4")]);
    await writeFile(join(directory, "review-scenes.json"), JSON.stringify({ recording: "recording.mp4", scenes: [{ name: "manual", at: 1 }, { name: "agent", at: 3.5 }] }));
    const outputs = await makeVisualReviews(root);
    assert.equal(outputs.length, 1);
    const stream = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration,nb_frames,avg_frame_rate", "-of", "json", outputs[0]], { encoding: "utf8" })).streams[0];
    assert.ok(Math.abs(Number(stream.duration) - 5.6) < 0.1);
    assert.equal(stream.avg_frame_rate, "20/1"); assert.ok(Number(stream.nb_frames) >= 110);
    await writeFile(join(directory, "review-scenes.json"), JSON.stringify({ recording: "../outside.mp4", scenes: [{ name: "invalid", at: 1 }] }));
    await assert.rejects(makeVisualReviews(root), /Invalid review recording/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
