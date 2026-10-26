// Assemble review clips from continuous recordings. Checkpoints use seconds
// relative to the recording start; screenshots are separate review artifacts.
import { readdir, readFile, access } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export async function makeVisualReviews(resultsRoot, runNames = null) {
  const root = resolve(resultsRoot);
  const outputs = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || (runNames && !runNames.includes(entry.name)))
      continue;
    const directory = join(root, entry.name);
    const files = await readdir(directory);
    let review = null;
    if (files.includes("review-scenes.json")) {
      review = JSON.parse(
        await readFile(join(directory, "review-scenes.json"), "utf8"),
      );
      if (!Array.isArray(review.scenes))
        throw new Error(`Invalid review manifest: ${directory}`);
    }
    const recording =
      review?.recording ??
      files.find((name) => name.endsWith(".webm")) ??
      (files.includes("recording.mp4") ? "recording.mp4" : null);
    if (!recording) {
      if (review?.scenes.length)
        throw new Error(`Review recording missing: ${directory}`);
      continue;
    }
    if (recording.startsWith("/") || recording.split(/[\\/]/).includes("..")) {
      throw new Error(`Invalid review recording: ${directory}`);
    }
    const input = join(directory, recording);
    await access(input);
    const standard = ["golden", "controller"].includes(review?.profile);
    const stream = standard
      ? JSON.parse(
          execFileSync(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_entries",
              "format=duration:stream=width,height",
              "-select_streams",
              "v:0",
              "-of",
              "json",
              input,
            ],
            { encoding: "utf8" },
          ),
        )
      : null;
    const encode = [
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ];
    let output;
    if (review?.scenes.length) {
      const filters = review.scenes.map((scene, i) => {
        if (
          typeof scene.name !== "string" ||
          !Number.isFinite(scene.at) ||
          scene.at < 0
        ) {
          throw new Error(`Invalid review checkpoint: ${directory}`);
        }
        const outcome = scene.name.startsWith("navigation-");
        const leadIn = scene.leadInS ?? (outcome ? 0.2 : 1.5);
        const duration = scene.durationS ?? (outcome ? 1.4 : 2.8);
        if (
          !Number.isFinite(leadIn) ||
          leadIn < 0 ||
          !Number.isFinite(duration) ||
          duration <= 0
        ) {
          throw new Error(`Invalid review clip timing: ${directory}`);
        }
        if (
          standard &&
          scene.at + duration > Number(stream.format.duration) + 0.08
        )
          throw new Error(`Recording ends before ${scene.name} completes`);
        const crop = scene.captureCrop ?? review.captureCrop;
        if (
          crop &&
          (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
            crop.x < 0 ||
            crop.y < 0 ||
            crop.width <= 0 ||
            crop.height <= 0 ||
            (standard &&
              (crop.x + crop.width > stream.streams[0].width ||
                crop.y + crop.height > stream.streams[0].height)))
        )
          throw new Error("Invalid capture crop");
        const framing = standard
          ? `${crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : ""}scale=1280:900:force_original_aspect_ratio=decrease,pad=1280:900:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,`
          : "";
        return `[0:v]trim=start=${Math.max(0, scene.at - leadIn).toFixed(3)}:duration=${duration},setpts=PTS-STARTPTS,${framing}null[v${i}]`;
      });
      output = join(
        directory,
        review.profile === "golden"
          ? "golden-path.mp4"
          : review.profile === "controller"
            ? "controller-path.mp4"
            : "interaction-review.mp4",
      );
      const labels = review.scenes.map((_, i) => `[v${i}]`).join("");
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          input,
          "-filter_complex",
          `${filters.join(";")};${labels}concat=n=${filters.length}:v=1:a=0[out]`,
          "-map",
          "[out]",
          ...encode,
          output,
        ],
        { stdio: "inherit" },
      );
    } else if (entry.name.startsWith("LidarReview-")) {
      output = join(directory, "lidar-review.mp4");
      execFileSync(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-i", input, ...encode, output],
        { stdio: "inherit" },
      );
    }
    if (output && standard) {
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            output,
          ],
          { encoding: "utf8" },
        ),
      );
      const duration = Number(probe.format.duration);
      const [minimum, maximum] =
        review.profile === "golden" ? [90, 120] : [20, 30];
      if (duration < minimum - 0.1 || duration > maximum + 0.1)
        throw new Error(
          `${review.profile} video is ${duration.toFixed(2)}s; expected ${minimum}–${maximum}s`,
        );
    }
    if (output) outputs.push(output);
  }
  return outputs;
}
