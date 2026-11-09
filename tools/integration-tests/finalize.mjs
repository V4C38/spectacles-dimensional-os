import { resolve, join, basename } from "node:path";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { makeVisualReviews } from "../visual-review.mjs";
import { goldenChapters } from "./catalog.mjs";
import { documents, finishRun, sourceIdentity, publishGoldenVideo } from "./artifacts.mjs";

export function alignRecording(directory, manifest) {
  if (!manifest.sync || manifest.sync.aligned) return;
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      resolve(directory, manifest.recording),
      "-t",
      "60",
      "-vf",
      "crop=8:8:0:0,scale=1:1,fps=25",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { maxBuffer: 1024 * 1024 },
  );
  let frame = -1;
  for (let i = 0; i < raw.length; i += 3)
    if (raw[i] > 170 && raw[i + 1] < 90 && raw[i + 2] > 170) {
      frame = i / 3;
      break;
    }
  if (frame < 0)
    throw new Error(
      "Recording clock marker was not captured; refusing guessed video timing",
    );
  const offset = frame / 25;
  for (const scene of manifest.scenes) {
    scene.at += offset;
    if (scene.screenshotAt !== undefined) scene.screenshotAt += offset;
  }
  manifest.sync = {
    ...manifest.sync,
    aligned: true,
    recordingOffsetS: offset,
    toleranceS: 0.04,
  };
}

/** Extract stills only after continuous flow recording has stopped. */
export async function extractStills(directory, manifest) {
  alignRecording(directory, manifest);
  const recording = resolve(directory, manifest.recording);
  await mkdir(join(directory, "diagnostics/stills"), { recursive: true });
  for (const scene of manifest.scenes) {
    const id = scene.id ?? scene.name;
    const time =
      scene.screenshotAt ??
      scene.at + Math.min((scene.durationS ?? 2.8) * 0.65, 1.5);
    const file = `diagnostics/stills/${id}.png`;
    const crop = scene.captureCrop ?? manifest.captureCrop;
    const filters = `${crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : ""}scale=1280:900:force_original_aspect_ratio=decrease,pad=1280:900:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(time),
      "-i",
      recording,
      "-vf",
      filters,
      "-frames:v",
      "1",
      join(directory, file),
    ]);
    scene.screenshot = file;
  }
  await writeFile(
    join(directory, "review-scenes.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
export async function finalize(root, client, scope = "all") {
  const extraMedia = process.env.INTEGRATION_EXTRA_MEDIA === "1";
  root = resolve(root);
  const finalSource = sourceIdentity();
  let initialSource;
  try { initialSource = JSON.parse(await readFile(join(root, "run.json"), "utf8")).source; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const manifests = await documents(root, "review-scenes.json");
  const validation = [];
  for (const row of manifests)
    if (row.value.profile === "golden") {
      const actual = row.value.scenes.map((scene) => scene.id ?? scene.name);
      const expected = goldenChapters(client).map((chapter) => chapter.id);
      validation.push({
        caseId: "artifact_validation",
        name: "golden_order",
        passed: JSON.stringify(actual) === JSON.stringify(expected),
      });
      let end = 0;
      for (const scene of row.value.scenes) {
        if (scene.at < end - 0.08)
          validation.push({
            caseId: "artifact_validation",
            name: "source_interval_order",
            passed: false,
          });
        end = scene.at + scene.durationS;
      }
    }
  for (const row of manifests)
    if (["golden", "controller"].includes(row.value.profile) && row.value.recordingRetained !== false) {
      try {
        await extractStills(row.directory, row.value);
      } catch (error) {
        validation.push({
          caseId: "artifact_validation",
          name: "stills",
          passed: false,
          detail: String(error),
        });
      }
    }
  // Encoder enumerates direct child suite directories; each recording stays in its suite.
  const parents = new Map();
  for (const row of manifests) {
    if (row.value.profile !== "golden" && !extraMedia) continue;
    const parent = resolve(row.directory, "..");
    parents.set(parent, [
      ...(parents.get(parent) ?? []),
      basename(row.directory),
    ]);
  }
  const videos = [];
  const artifactChecks = validation;
  for (const [parent, names] of parents) for (const name of names) {
    try {
      videos.push(...(await makeVisualReviews(parent, [name])));
    } catch (error) {
      artifactChecks.push({
        caseId: "artifact_validation",
        name: "video",
        passed: false,
        detail: String(error),
      });
    }
  }
  for (const video of videos)
    if (/\/(golden|controller)-path\.mp4$/.test(video)) {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(
        video,
        join(
          root,
          video.endsWith("golden-path.mp4")
            ? "golden-path.mp4"
            : "controller-path.mp4",
        ),
      );
    }
  if (["all", "golden"].includes(scope)) {
    artifactChecks.push({
      caseId: "artifact_validation",
      name: "golden_video_present",
      passed: videos.some((path) => path.endsWith("/golden-path.mp4")),
    });
    if (extraMedia && client === "webxr" && scope === "all")
      artifactChecks.push({
        caseId: "artifact_validation",
        name: "controller_video_present",
        passed: videos.some((path) => path.endsWith("/controller-path.mp4")),
      });
  }
  if (initialSource) artifactChecks.push({
    caseId: "artifact_validation", name: "source_unchanged",
    passed: initialSource.fingerprint === finalSource.fingerprint,
  });
  const result = await finishRun(root, client, {
    source: initialSource ?? finalSource,
    scope,
    checks: artifactChecks,
    metadata: { finalSource, videos: videos.map((path) => path.replace(root + "/", "")) },
  });
  if (result.passed && !extraMedia && process.env.INTEGRATION_DEFER_MEDIA_CLEANUP !== "1") {
    for (const row of manifests) {
      if (row.value.profile === "golden" || !row.value.recording) continue;
      const recording = resolve(row.directory, row.value.recording);
      if (!recording.startsWith(root + "/")) throw new Error("Recording cleanup escaped run directory");
      await rm(recording, { force: true });
      row.value.recordingRetained = false;
      await writeFile(row.path, JSON.stringify(row.value, null, 2) + "\n");
    }
  }
  // Specs must first restore and audit the production project in its native runner.
  if (client === "webxr") await publishGoldenVideo(root, client);
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (pairs, value, index, all) =>
          value.startsWith("--")
            ? [...pairs, [value.slice(2), all[index + 1]]]
            : pairs,
        [],
      ),
  );
  if (args["publish-only"]) {
    const target = await publishGoldenVideo(args.run, args.client);
    process.stdout.write(`${target ? "Published: " + target : "Golden publication skipped: run is not fully verified"}\n`);
  } else {
    const result = await finalize(args.run, args.client, args.scope ?? "all");
    process.stdout.write(`${result.passed ? "PASS" : "FAIL"}: ${args.run}\n`);
    process.exitCode = result.passed ? 0 : 1;
  }
}
