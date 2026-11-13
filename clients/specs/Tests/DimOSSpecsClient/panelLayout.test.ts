import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SetupWizardView } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView";
import { RUNTIME_LAYOUTS, SETUP_LAYOUTS, PANEL_GEOMETRY, panelContentOffset, panelFooterY, easePanel } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsPanelPresentation";

describe("compact panel geometry", () => {
  it("fits every stable state without changing the calibrated width", () => {
    expect(PANEL_GEOMETRY.width).toBe(90);
    for (const profile of [...Object.values(RUNTIME_LAYOUTS), ...Object.values(SETUP_LAYOUTS)]) {
      expect(profile.height).toBeLessThanOrEqual(76);
      expect(profile.height).toBeGreaterThan(30);
      for (const y of Object.values(profile.rows)) expect(y).toBeLessThan(28.6);
    }
    expect(RUNTIME_LAYOUTS.alignment.height).toBeLessThan(RUNTIME_LAYOUTS.agent.height);
    expect(SETUP_LAYOUTS.entry.height).toBeLessThan(SETUP_LAYOUTS.connected.height);
  });
  it("keeps the top edge and header fixed while only the bottom moves", () => {
    for (const height of [42, 55, 68, 76]) {
      const centerShift = (76 - height) / 2;
      expect(centerShift + height / 2).toBe(38);
      expect(centerShift + panelContentOffset(height) + 28.6).toBeCloseTo(28.6);
      expect(centerShift + panelContentOffset(height) + panelFooterY(height) - 3.2).toBeCloseTo(38 - height + 5);
    }
  });
  it("packs entry and status with consistent gaps", () => {
    const r = SETUP_LAYOUTS.entry.rows;
    expect(r.intro).toBeUndefined();
    expect(r.status + 2).toBeCloseTo(14.5);
    expect(r.status - 2 - (r.entry + 3.2)).toBeCloseTo(2);
  });
  it("eases both ends and clamps elapsed time", () => {
    expect(easePanel(-1)).toBe(0); expect(easePanel(2)).toBe(1);
    expect(easePanel(0.5)).toBe(0.5);
    expect(easePanel(0.1)).toBeLessThan(0.1);
    expect(easePanel(0.9)).toBeGreaterThan(0.9);
  });
});


it("keeps the native layout import distinct from the packaged panel policy", () => {
  const source = readFileSync(new URL("../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]);
  const packagedPolicy = imports.find(path => path.startsWith("DimOSARClient.lspkg/") && path.endsWith("/ControlPanelPresentation"));
  const nativeLayout = imports.find(path => path === "./SpecsPanelPresentation");
  expect(packagedPolicy).toBeDefined();
  expect(nativeLayout).toBeDefined();
  // The editor's native loader must receive distinguishable module names.
  expect(basename(nativeLayout!)).not.toBe(basename(packagedPolicy!));
});

it("initializes actual setup layouts before constructing the native scene", () => {
  const reachedNativeScene = new Error("native scene construction reached");
  const panel = { getChildrenCount: () => { throw reachedNativeScene; } } as unknown as SceneObject;
  // Exercise the real constructor's field initializers; prototype-only tests skip them.
  expect(() => new SetupWizardView(panel)).toThrow(reachedNativeScene);
});
