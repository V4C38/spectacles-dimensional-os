import { expect, it } from "vitest";
import { WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import { armMaterial } from "../src/manipulation/ArmMaterial";
import { AdaptiveDashedLineRenderer } from "../src/presentation/AdaptiveDashedLineRenderer";

it("keeps the arm interior faint while retaining a soft, much more opaque rim", () => {
  const arm = armMaterial(), tool = armMaterial(true);
  expect(arm.uniforms.uFill.value).toBeLessThanOrEqual(0.02);
  expect(arm.uniforms.uFill.value + arm.uniforms.uRim.value).toBeCloseTo(0.92);
  expect(tool.uniforms.uFill.value).toBeLessThan(arm.uniforms.uFill.value);
  expect(tool.uniforms.uFill.value + tool.uniforms.uRim.value).toBeCloseTo(0.82);
  expect(arm.uniforms.uPower.value).toBe(5);
  expect(arm.depthWrite).toBe(false);
  arm.dispose(); tool.dispose();
});

it("applies near-width reduction independently of each stroke variant's width and opacity", () => {
  for (const width of [0.0008, 0.00275]) {
    const line = new AdaptiveDashedLineRenderer(width);
    line.setStyle(width, 0.45);
    expect(line.object.material.uniforms.uNearWidthScale.value).toBe(0.75);
    expect(line.object.material.uniforms.uWidth.value).toBe(width);
    expect(line.object.material.uniforms.uOpacity.value).toBe(0.45);
    line.dispose();
  }
});

it("uses the world dash period on soft contours and resolves distant dashes to solid", () => {
  for (const thin of [false, true]) {
    const material = armMaterial(thin);
    expect(material.uniforms.uDash.value).toBe(WORLD_DASH_STYLE.dashM);
    expect(material.uniforms.uGap.value).toBe(WORLD_DASH_STYLE.gapM);
    expect(material.fragmentShader).toContain("smoothstep(6.0, 10.0");
    expect(material.fragmentShader).toContain("rim * uRim * contourCoverage");
    material.dispose();
  }
});
