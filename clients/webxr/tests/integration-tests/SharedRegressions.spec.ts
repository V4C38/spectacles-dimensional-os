import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrap, snapshot, shared } from "./fixtures/Runtime";
import {
  activateButton,
  activateRuntimeButton,
  pointRuntimeButton,
  setSelection,
  summonMenu,
  frameMenu,
  moveInput,
} from "./fixtures/Input";

const value = (page: Page, expression: string) =>
  page.evaluate((expression) => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
    return new Function("app", "w", `return (${expression})`)(app, w);
  }, expression);
const ids = shared.cases
  .filter((row: any) => row.group === "regression" && row.platforms.includes("webxr"))
  .map((row: any) => row.id) as string[];
for (const id of ids)
  test(`shared regression: ${id}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const directory = join(
      process.env.INTEGRATION_RESULTS_DIR ?? info.outputDir,
      "regression",
      id,
    );
    await mkdir(directory, { recursive: true });
    const checks: any[] = [],
      images: any[] = [];
    const screenshot = async (suffix = "") => {
      const file = `${id}${suffix}.png`;
      await page.screenshot({ path: join(directory, file) });
      images.push({ id: id + suffix, file });
    };
    try {
      const runtime = await bootstrap(page, "hand", {
        unavailable: id === "capabilities_unavailable",
      });
      if (id === "setup_navigation") {
      await frameMenu(page);
      await screenshot("_entry");
        expect((await snapshot(page)).backVisible).toBe(false);
        await activateButton(page);
        expect((await snapshot(page)).wizardStep).toBe("localization");
        await activateButton(page);
        expect((await snapshot(page)).setupCompleted).toBe(true);
      } else if (id === "capabilities_unavailable") {
        await activateButton(page);
        await activateButton(page);
        await summonMenu(page);
        await frameMenu(page);
        const s = await snapshot(page);
        expect(s.agentAvailable).toBe(false);
        expect(s.lidarAvailable).toBe(false);
        expect(s.estopAvailable).toBe(false);
        const before = runtime.commands.length;
        await page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          app.client.emergencyStop();
          app.client.ui.sensors.setMode("full");
        });
        expect(
          runtime.commands
            .slice(before)
            .filter((c) =>
              ["estop_request", "lidar_settings_request"].includes(c.type),
            ),
        ).toHaveLength(0);
      } else if (id === "localization_providers") {
        await activateButton(page);
        for (const [policy, kind] of [
          ["robot_los_required", "marker"],
          ["any_angle", "vps"],
          ["robot_los_preferred", "mixed"],
        ]) {
          runtime.send({
            type: "localization_observations_request",
            capture_policy: policy,
            observation_count: 1,
            ...(policy === "robot_los_preferred"
              ? { wait_timeout_s: 0.2 }
              : {}),
          });
          await expect
            .poll(() => snapshot(page).then((s) => s.localizationKind))
            .toBe(kind);
          await screenshot(`_${kind}`);
        }
      } else if (id === "localization_rejection") {
        await activateButton(page);
        runtime.send({
          type: "localization_result",
          position: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          confidence: 1,
          ts: -1,
        });
        await page.waitForTimeout(300);
        expect((await snapshot(page)).hasTrackingOrigin).toBe(false);
        expect((await snapshot(page)).setupCompleted).toBe(false);
        await page.evaluate(() => {
          const app = (window as any).xb.core.scene.children.find(
            (o: any) => o.constructor.name === "WebXRApp",
          );
          app.client.camera.jpeg.encode = async () => {
            throw new Error("Fixture camera unavailable");
          };
        });
        runtime.send({
          type: "localization_observations_request",
          capture_policy: "any_angle",
          observation_count: 1,
        });
        await expect
          .poll(() =>
            value(page, "app.client.episode.view().lastError !== null"),
          )
          .toBe(true);
      } else {
        await runtime.localized();
        await summonMenu(page);
        await frameMenu(page);
        if (id === "connection_recovery") {
          await activateRuntimeButton(page, "Robot selection button");
          expect((await snapshot(page)).robotSelected).toBe(true);
          runtime.close();
          await expect
            .poll(() => snapshot(page).then((s) => s.robotSelected))
            .toBe(false);
          await screenshot("_lost");
          await expect
            .poll(() => value(page, "app.client.session.view().connection"), {
              timeout: 15000,
            })
            .toBe("ready");
          expect((await snapshot(page)).robotSelected).toBe(false);
        } else if (id === "tracking_recovery") {
          await page.evaluate(() => {
            const w = window as any,
              session = w.xb.core.renderer.xr.getSession();
            Object.defineProperty(session, "visibilityState", {
              value: "hidden",
              writable: true,
              configurable: true,
            });
            session.dispatchEvent(new Event("visibilitychange"));
          });
          await expect.poll(() => value(page, "app.tracking")).toBe(false);
          await screenshot("_lost");
          await page.evaluate(() => {
            const session = (window as any).xb.core.renderer.xr.getSession();
            session.visibilityState = "visible";
            session.dispatchEvent(new Event("visibilitychange"));
          });
          await expect.poll(() => value(page, "app.tracking")).toBe(true);
          expect((await snapshot(page)).hasTrackingOrigin).toBe(true);
        } else if (id === "interaction_safety") {
          const before = runtime.commands.filter(
            (c) => c.type === "nav_goal_request" && !c.preview,
          ).length;
          await pointRuntimeButton(page, "Manual");
          await setSelection(page, 1);
          await moveInput(page, [0.04, 0, 0]);
          await setSelection(page, 0);
          expect(
            runtime.commands.filter(
              (c) => c.type === "nav_goal_request" && !c.preview,
            ),
          ).toHaveLength(before);
          expect(
            await value(
              page,
              "!app.worldHold && !app.client.navigation.interaction.snapshot().placementHeld",
            ),
          ).toBe(true);
        } else if (id === "navigation_failure") {
          runtime.send({
            type: "nav_goal",
            pose: shared.fixtures.goal.concat(0),
            path_poses: shared.fixtures.path,
            ts: Date.now() / 1000,
          });
          runtime.state("following_path");
          await page.waitForTimeout(80);
          runtime.state("resolved", "failed");
          await expect
            .poll(() => value(page, "app.client.navigation.flash()"), {
              intervals: [20, 30],
            })
            .toBe("failed");
          await screenshot("_animation");
        } else if (id === "emergency_stop") {
          const before = runtime.commands.filter(
            (c) => c.type === "estop_request",
          ).length;
          await activateRuntimeButton(page, "EMERGENCY STOP");
          await expect
            .poll(
              () =>
                runtime.commands.filter((c) => c.type === "estop_request")
                  .length,
            )
            .toBe(before + 1);
        } else if (id === "speech_lifecycle") {
          await activateRuntimeButton(page, "Robot selection button");
          await activateRuntimeButton(page, "Agent");
          await pointRuntimeButton(page, "Agent dictation field");
          await setSelection(page, 1);
          await page.evaluate(() =>
            (window as any).integrationTranscript(
              "Do not send this cancelled recording",
              false,
            ),
          );
          await page.evaluate(
            () => ((window as any).questDevice.hands.right.connected = false),
          );
          await expect
            .poll(() =>
              value(
                page,
                "app.client.speech.snapshot().status !== 'Listening'",
              ),
            )
            .toBe(true);
          await page.evaluate(
            () => ((window as any).questDevice.hands.right.connected = true),
          );
          expect(
            runtime.commands.filter((c) => c.type === "user_message_request"),
          ).toHaveLength(0);
          await page.evaluate(() => {
            const app = (window as any).xb.core.scene.children.find(
              (o: any) => o.constructor.name === "WebXRApp",
            );
            app.client.speech.setDraft("A retained message. ".repeat(80));
          });
          const draft = await value(
            page,
            "app.client.speech.snapshot().prompt",
          );
          await activateRuntimeButton(page, "Manual");
          await activateRuntimeButton(page, "Agent");
          expect(await value(page, "app.client.speech.snapshot().prompt")).toBe(
            draft,
          );
          expect(
            await value(page, "app.mainMenu.inputLabel.maxScroll > 0"),
          ).toBe(true);
        } else if (id === "speech_errors") {
          await activateRuntimeButton(page, "Robot selection button");
          await activateRuntimeButton(page, "Agent");
          await pointRuntimeButton(page, "Agent dictation field");
          await setSelection(page, 1);
          await page.evaluate(() =>
            (window as any).integrationRecognitionError(
              "Fixture recognition unavailable",
            ),
          );
          await setSelection(page, 0);
          await expect
            .poll(() =>
              value(
                page,
                "app.client.speech.snapshot().error?.includes('Fixture recognition unavailable')",
              ),
            )
            .toBe(true);
          await screenshot("_recognition");
          runtime.send({
            type: "agent_message",
            text: "No client pose: fixture agent cannot reach the destination",
          });
          await expect
            .poll(() =>
              value(page, "app.mainMenu.agent.text.includes('cannot reach')"),
            )
            .toBe(true);
        } else if (id === "audio_reset") {
          await activateRuntimeButton(page, "Global settings");
          await activateRuntimeButton(page, "Sound · On");
          await activateRuntimeButton(page, "Setup");
          await expect
            .poll(() => snapshot(page).then((s) => s.setupCompleted))
            .toBe(false);
          expect(await value(page, "app.client.speech.snapshot().prompt")).toBe(
            "",
          );
        } else if (id === "sensor_limits") {
          await activateRuntimeButton(page, "Sensors button");
          await activateRuntimeButton(page, "Full");
          runtime.lidar();
          expect((await snapshot(page)).lidarPreferences.pointLimit).toBe(
            shared.fixtures.pointLimit,
          );
          await page.evaluate(() => {
            const app = (window as any).xb.core.scene.children.find(
              (o: any) => o.constructor.name === "WebXRApp",
            );
            for (let i = 0; i < 30; i++) {
              app.client.ui.sensors.adjustRange(-1);
              app.client.ui.sensors.adjustPoints(-1);
            }
          });
          expect((await snapshot(page)).lidarPreferences).toMatchObject({
            fullRangeM: 0.5,
            pointLimit: 250,
          });
          await page.evaluate(() => {
            const app = (window as any).xb.core.scene.children.find(
              (o: any) => o.constructor.name === "WebXRApp",
            );
            for (let i = 0; i < 30; i++) {
              app.client.ui.sensors.adjustRange(1);
              app.client.ui.sensors.adjustPoints(1);
            }
          });
          expect((await snapshot(page)).lidarPreferences).toMatchObject({
            fullRangeM: 10,
            pointLimit: 4000,
          });
        }
      }
      await screenshot();
      checks.push({ caseId: id, name: id, passed: true });
    } catch (error) {
      checks.push({
        caseId: id,
        name: id,
        passed: false,
        detail: String(error),
      });
      throw error;
    } finally {
      await writeFile(
        join(directory, "case-results.json"),
        JSON.stringify({ checks, images }, null, 2),
      );
    }
  });
