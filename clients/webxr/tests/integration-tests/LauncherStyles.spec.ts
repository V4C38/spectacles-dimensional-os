import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const launcherCss = readFileSync(new URL("../../../../launcher/app/static/app.css", import.meta.url), "utf8");

test("launcher shared controls retain metrics, keyboard focus and enabled-only hover", async ({ page }) => {
  await page.setContent(`<style>${launcherCss}</style><main class="app">
    <section>
      <button id="enabled">Enabled</button>
      <button id="disabled" disabled>Disabled</button>
      <select id="select"><option>Robot</option></select>
      <input id="input" value="Profile">
      <details><summary id="summary">Calibration</summary></details>
    </section>
  </main>`);
  const selectors = await page.evaluate(() => Array.from(document.styleSheets[0].cssRules)
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .map(rule => rule.selectorText));
  expect(selectors).toContain(".app :is(button, select)");
  expect(selectors).toContain(".app :is(button, summary, select, input):focus-visible");
  expect(selectors).toContain(".app :is(button, summary):hover:not(:disabled)");
  for (const id of ["enabled", "disabled", "select", "input", "summary"]) {
    const control = page.locator(`#${id}`);
    await expect(control).toHaveCSS("height", "44px");
    await expect(control).toHaveCSS("border-radius", "6px");
  }
  const enabled = page.locator("#enabled");
  const disabled = page.locator("#disabled");
  const normalBackground = await enabled.evaluate(element => getComputedStyle(element).backgroundColor);
  const disabledBackground = await disabled.evaluate(element => getComputedStyle(element).backgroundColor);
  await enabled.hover();
  await expect(enabled).not.toHaveCSS("background-color", normalBackground);
  await disabled.hover();
  await expect(disabled).toHaveCSS("background-color", disabledBackground);
  await page.mouse.move(1200, 850);
  await expect(enabled).toHaveCSS("background-color", normalBackground);
  await page.keyboard.press("Tab");
  await expect(enabled).toBeFocused();
  await expect(enabled).toHaveCSS("outline-style", "solid");
  await expect(enabled).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Tab");
  await expect(page.locator("#select")).toBeFocused();
  await expect(page.locator("#select")).toHaveCSS("outline-width", "2px");
});

const launcherLogModule = readFileSync(new URL("../../../../launcher/app/static/log-console.mjs", import.meta.url), "utf8");

test("launcher logs highlight failures and confirmed connections without coloring ordinary progress", async ({ page }) => {
  await page.setContent(`<style>${launcherCss}</style><div class="log" id="log"></div>`);
  const tones = await page.evaluate(async source => {
    const { logConsole } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    const logEl = document.querySelector("#log")!;
    const logger = logConsole({ logEl, logFilterLevel: { value: "debug" },
      logFilterSource: { value: "all" }, copyLogBtn: {} });
    for (const line of ["Start error: device unavailable", "WebRTC connected", "Preparing camera", "CAN ready"])
      logger.appendLog(line);
    await new Promise(requestAnimationFrame);
    return [...logEl.children].map(node => ({ tone: (node as HTMLElement).dataset.tone,
      color: getComputedStyle(node).color }));
  }, launcherLogModule);
  expect(tones.map(line => line.tone)).toEqual(["error", "success", "normal", "success"]);
  expect(tones[0].color).not.toBe(tones[2].color);
  expect(tones[1].color).not.toBe(tones[2].color);
  expect(tones[1].color).toBe(tones[3].color);
});
