import { expect, it } from "vitest";
import { AdaptiveDashedLineRenderer } from "../src/presentation/AdaptiveDashedLineRenderer";
it("anchors route dash phase continuously and retires cached GPU capacity on resizing", () => {
  const line = new AdaptiveDashedLineRenderer();
  line.setSegments([[0, 0, 0], [0, 0, 1]], true);
  const first = line.object.geometry;
  line.setSegments([[0, 0, 0], [0, 0, 1], [0, 0, 1], [0, 0, 3]], true);
  expect(line.object.geometry).not.toBe(first);
  expect(line.object.geometry.instanceCount).toBe(2);
  expect(line.object.geometry.getAttribute("instanceDistance").getX(1)).toBe(1);
  line.setStyle(0.00275, 0.7);
  expect(line.object.material.uniforms.uOpacity.value).toBe(0.7);
  line.dispose();
});

it("keeps mobile pixel thickness while allowing thinner stationary strokes", () => {
  const mobile=new AdaptiveDashedLineRenderer();
  const arm=new AdaptiveDashedLineRenderer(0.0017875,undefined,undefined,1.3);
  expect(mobile.object.material.uniforms.uMinimumPixels.value).toBe(2);
  expect(arm.object.material.uniforms.uMinimumPixels.value).toBe(1.3);
  expect(arm.object.material.uniforms.uDash.value).toBe(mobile.object.material.uniforms.uDash.value);
  expect(arm.object.material.uniforms.uGap.value).toBe(mobile.object.material.uniforms.uGap.value);
  mobile.dispose();arm.dispose();
});
