// Produce a short, normal-speed animation review from the real browser interaction recording.
// Usage: node tools/make-visual-review.mjs [test-results]
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(process.argv[2] ?? "test-results");
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(root, entry.name);
  let review;
  try { review = JSON.parse(await readFile(join(directory, "review-scenes.json"), "utf8")); } catch { review = null; }
  const video = (await readdir(directory)).find(name => name.endsWith(".webm"));
  if (!video) continue;
  if (!review && entry.name.startsWith("LidarReview-")) {
    const output = join(directory, "lidar-review.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(directory, video), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { stdio: "inherit" });
    process.stdout.write(`${output}\n`);
    continue;
  }
  if (!review?.scenes.length) continue;
  // Include the transition leading into each screenshot and a brief settled view. No speed-up.
  const scenes = review.scenes;
  const filters = scenes.map((scene, i) => {
    const outcome = scene.name.startsWith("navigation-");
    return `[0:v]trim=start=${Math.max(0, scene.at - (outcome ? 0.2 : 1.5)).toFixed(3)}:duration=${outcome ? 1.4 : 2.8},setpts=PTS-STARTPTS[v${i}]`;
  });
  const labels = scenes.map((_, i) => `[v${i}]`).join("");
  const output = join(directory, "interaction-review.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(directory, video), "-filter_complex", `${filters.join(";")};${labels}concat=n=${filters.length}:v=1:a=0[out]`, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { stdio: "inherit" });
  process.stdout.write(`${output}\n`);
}
