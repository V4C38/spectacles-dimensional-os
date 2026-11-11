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
