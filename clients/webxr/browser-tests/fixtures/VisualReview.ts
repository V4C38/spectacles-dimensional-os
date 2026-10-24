import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";

const reviews = new WeakMap<Page, { startedAt: number; scenes: { name: string; at: number }[] }>();
const INCLUDED = new Set(["connected.png", "localization.png", "laser-empty-space.png", "robot-selected.png", "laser-navigation.png", "robot-control-menu.png", "agent-control-menu.png", "source-anchored-menu.png", "following-path.png", "setup-success.png"]);

export function startVisualReview(page: Page): void { reviews.set(page, { startedAt: Date.now(), scenes: [] }); }
export function markVisualReview(page: Page, name: string): void {
  const review = reviews.get(page);
  if (!review || !INCLUDED.has(name) || review.scenes.some(scene => scene.name === name)) return;
  review.scenes.push({ name, at: (Date.now() - review.startedAt) / 1000 });
}
export async function saveVisualReview(page: Page, info: TestInfo): Promise<void> {
  const review = reviews.get(page);
  if (!review || review.scenes.length === 0) return;
  await writeFile(info.outputPath("review-scenes.json"), JSON.stringify(review, null, 2));
}
