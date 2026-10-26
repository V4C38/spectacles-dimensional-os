import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { shared } from "./Runtime";

export class Flow {
  readonly checks: {
    caseId: string;
    name: string;
    passed: boolean;
    detail?: string;
  }[] = [];
  readonly scenes: any[] = [];
  private epoch = 0;
  constructor(
    private readonly page: Page,
    readonly directory: string,
    private readonly profile = "golden",
  ) {}
  async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    this.epoch = await this.page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const marker = document.createElement("div");
      marker.id = "integration-clock";
      marker.style.cssText =
        "position:fixed;left:0;top:0;width:12px;height:12px;background:#ff00ff;z-index:2147483647;pointer-events:none";
      const at = Date.now();
      document.body.append(marker);
      return at;
    });
    await this.page.waitForTimeout(300);
    await this.page.evaluate(() =>
      document.querySelector("#integration-clock")?.remove(),
    );
  }
  async step(
    id: string,
    action: () => Promise<void>,
    condition: () => Promise<unknown>,
    options: { screenshotOffsetS?: number; durationS?: number } = {},
  ): Promise<void> {
    const chapter = shared.golden.chapters.find((row: any) => row.id === id);
    const at = (Date.now() - this.epoch) / 1000;
    let screenshotAt = at;
    try {
      await action();
      await expect.poll(condition, { message: id }).toBe(true);
      screenshotAt =
        (Date.now() - this.epoch) / 1000 + (options.screenshotOffsetS ?? 0.2);
      const target = process.env.INTEGRATION_SMOKE
        ? 0.2
        : (options.durationS ?? chapter?.durationS ?? 3);
      await this.page.waitForTimeout(
        Math.max(0, target * 1000 - (Date.now() - this.epoch - at * 1000)),
      );
      this.checks.push({ caseId: id, name: id, passed: true });
    } catch (error) {
      const state = await this.page
        .evaluate(() => {
          const w = window as any,
            app = w.xb?.core.scene.children.find(
              (o: any) => o.constructor.name === "WebXRApp",
            );
          return {
            ui: app?.client.ui.snapshot(),
            elapsed: app?.client.ui.successElapsedS,
            tracking: app?.tracking,
            source: app?.menuAnchor.source?.handedness,
          };
        })
        .catch(() => null);
      this.checks.push({
        caseId: id,
        name: id,
        passed: false,
        detail: String(error) + "\n" + JSON.stringify(state),
      });
      throw error;
    } finally {
      this.scenes.push({
        id,
        name: id,
        at,
        leadInS: 0,
        durationS: (Date.now() - this.epoch) / 1000 - at,
        screenshotAt,
      });
    }
  }
  async save(info: TestInfo): Promise<void> {
    const video = this.page.video();
    await writeFile(
      join(this.directory, "review-scenes.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          client: "webxr",
          profile: this.profile,
          recording: "recording.webm",
          sync: { epochMs: this.epoch, color: [255, 0, 255] },
          scenes: this.scenes,
          smoke: !!process.env.INTEGRATION_SMOKE,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(this.directory, "case-results.json"),
      JSON.stringify({ checks: this.checks, testStatus: info.status }, null, 2),
    );
    await this.page.close();
    if (!video) throw new Error("Integration recording unavailable");
    await video.saveAs(join(this.directory, "recording.webm"));
  }
}
