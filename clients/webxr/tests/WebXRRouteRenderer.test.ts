import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { WebXRRouteRenderer } from "../src/navigation/WebXRNavigationRenderer";
import { WORLD_DASH_STYLE, ROBOT_LINE_STYLE } from "@dimos-ar-client/presentation/WorldPresentation";
const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
const dashed = (route: WebXRRouteRenderer) => route.object.getObjectByName("Adaptive dashed line") as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
const ribbon = (route: WebXRRouteRenderer) => route.object.getObjectByName("Executing route ribbon") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
it("updates the visible stroke through route growth, motion and shrinkage and disposes it", () => {
  const route = new WebXRRouteRenderer();
  try {
    for (const points of [[0,.1], [0,.1,1,5], [0,.1,1,6], [0,.1]]) {
      route.apply(points.map(x => [x,0,0,0]), origin, true, 0, 0);
      const geometry = dashed(route).geometry, ends = geometry.getAttribute("instanceEnd");
      expect(geometry.instanceCount).toBe(ends.count);
      expect(ends.getZ(ends.count - 1)).toBeCloseTo(-points[points.length - 1]);
      expect(dashed(route).visible).toBe(true);
    }
    const dispose = vi.spyOn(dashed(route).geometry, "dispose");
    route.dispose(); expect(dispose).toHaveBeenCalledOnce();
  } finally { route.dispose(); }
});
it("clips dashed paths to circles and preserves physical dash styling", () => {
  const route = new WebXRRouteRenderer();
  try {
    route.apply([[0,0,0,0],[2,0,0,0]], origin, true, 0, 0, { preview: true,
      startCircle: { center: [0,.001,0], radius: .06 }, endCircle: { center: [0,.015,-2], radius: .268 } });
    const stroke = dashed(route), start = stroke.geometry.getAttribute("instanceStart"), end = stroke.geometry.getAttribute("instanceEnd");
    expect(start.getZ(0)).toBeCloseTo(-.06); expect(start.getY(0)).toBeCloseTo(.001);
    expect(end.getZ(end.count-1)).toBeCloseTo(-1.732); expect(end.getY(end.count-1)).toBeCloseTo(.015);
    expect(stroke.material.uniforms.uOpacity.value).toBe(.6);
    expect(stroke.material.uniforms.uDash.value).toBe(ROBOT_LINE_STYLE.dashM);
    expect(stroke.material.uniforms.uGap.value).toBe(ROBOT_LINE_STYLE.gapM);
    expect(stroke.material.uniforms.uWidth.value).toBe(WORLD_DASH_STYLE.widthM);
  } finally { route.dispose(); }
});
it("uses a visible solid ribbon during execution and dashed previews", () => {
  const route = new WebXRRouteRenderer();
  try {
    const path: [number,number,number,number][] = [[0,0,0,0],[2,0,0,0]];
    const style = { executing: true, startCircle: { center: [0,0,0] as [number,number,number], radius: .06 }, endCircle: { center: [0,0,-2] as [number,number,number], radius: .3 } };
    route.apply(path, origin, true, 0, 0, style);
    expect(ribbon(route).visible).toBe(true); expect(dashed(route).visible).toBe(false);
    expect(ribbon(route).material.opacity).toBe(.85);
    const positions = ribbon(route).geometry.getAttribute("position");
    const zs = Array.from({ length: positions.count }, (_,i) => positions.getZ(i));
    expect(Math.max(...zs)).toBeCloseTo(-.06); expect(Math.min(...zs)).toBeCloseTo(-1.7);
    route.apply(path, origin, true, 0, 0, { ...style, preview: true });
    expect(ribbon(route).visible).toBe(false); expect(dashed(route).visible).toBe(true);
    expect(dashed(route).material.uniforms.uOpacity.value).toBe(.6);
  } finally { route.dispose(); }
});
