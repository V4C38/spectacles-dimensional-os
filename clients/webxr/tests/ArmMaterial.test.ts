import { expect, it } from "vitest";
import { armMaterial } from "../src/manipulation/ArmMaterial";
import { AdaptiveDashedLineRenderer } from "../src/presentation/AdaptiveDashedLineRenderer";

it("renders a flat twenty-eight-percent surface without Fresnel contours", () => {
  for (const material of [armMaterial(), armMaterial(true)]) {
    expect(material.fragmentShader).toContain("0.28 * uOpacity");
    expect(material.fragmentShader).not.toContain("vNormal");
    expect(material.uniforms.uRim).toBeUndefined();
    expect(material.depthWrite).toBe(false);
    material.dispose();
  }
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
