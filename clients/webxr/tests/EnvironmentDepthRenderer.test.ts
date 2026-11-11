import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { EnvironmentDepthRenderer } from "../src/presentation/EnvironmentDepthRenderer";

it("requests optional depth without removing existing features", () => {
  const options = EnvironmentDepthRenderer.sessionOptions({
    optionalFeatures: ["hand-tracking"],
    requiredFeatures: ["local-floor"],
  });
  expect(options.optionalFeatures).toEqual(["hand-tracking", "depth-sensing"]);
  expect(options.requiredFeatures).toEqual(["local-floor"]);
});

it("patches only explicitly marked geometry and restores renderer hooks", () => {
  const original = vi.fn(() => null);
  const renderer = {
    xr: { getDepthSensingMesh: original, getCamera: () => ({ cameras: [] }) },
  } as unknown as THREE.WebGLRenderer;
  const depth = new EnvironmentDepthRenderer(renderer);
  const root = new THREE.Group();
  const bounds = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(),
    new THREE.MeshBasicMaterial({ depthTest: false }),
  );
  bounds.userData.environmentDepth = true;
  root.add(bounds, handle);
  const oldCompile = bounds.material.onBeforeCompile,
    handleCompile = handle.material.onBeforeCompile;
  depth.update(
    { session: {} } as XRFrame,
    { views: [] } as unknown as XRViewerPose,
    [root],
  );
  expect(bounds.material.onBeforeCompile).not.toBe(oldCompile);
  expect(handle.material.onBeforeCompile).toBe(handleCompile);
  expect(handle.material.depthTest).toBe(false);
  const patchedVersion = bounds.material.version;
  root.remove(bounds);
  depth.update(
    { session: {} } as XRFrame,
    { views: [] } as unknown as XRViewerPose,
    [root],
  );
  expect(bounds.material.onBeforeCompile).toBe(oldCompile);
  expect(bounds.material.version).toBeGreaterThan(patchedVersion);
  depth.dispose();
  expect(renderer.xr.getDepthSensingMesh).toBe(original);
  expect(bounds.material.onBeforeCompile).toBe(oldCompile);
  bounds.geometry.dispose();
  bounds.material.dispose();
  handle.geometry.dispose();
  handle.material.dispose();
});

it("binds depth for each eye and disables both passes when one eye is invalid", () => {
  const eyes = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
  const viewports = [new THREE.Vector4(0, 0, 800, 900), new THREE.Vector4(800, 0, 800, 900)];
  eyes.forEach((eye, i) => Object.assign(eye, { viewport: viewports[i] }));
  const views = [{ eye: "left" }, { eye: "right" }] as XRView[];
  const textures = [{}, {}] as WebGLTexture[];
  const transforms = [new THREE.Matrix4().makeTranslation(0.1, 0.2, 0), new THREE.Matrix4().makeScale(0.8, 0.9, 1)];
  const records = views.map((_, i) => ({
    texture: textures[i], textureType: "texture-array", isValid: true, depthNear: 0.1,
    normDepthBufferFromNormView: { matrix: transforms[i].toArray() },
  }));
  const getDepthInformation = vi.fn((view: XRView) => records[views.indexOf(view)]);
  const originalDepthMesh = vi.fn(() => null);
  const renderer = {
    xr: {
      getDepthSensingMesh: originalDepthMesh,
      getCamera: () => ({ cameras: eyes }),
      getBinding: () => ({ getDepthInformation }),
    },
  } as unknown as THREE.WebGLRenderer;
  const frame = { session: { depthUsage: "gpu-optimized" } } as XRFrame;
  const viewer = { views } as unknown as XRViewerPose;
  const depth = new EnvironmentDepthRenderer(renderer);
  const marked = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const control = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ depthTest: false }));
  marked.userData.environmentDepth = true;
  const root = new THREE.Group().add(marked, control);
  const originalCompile = vi.fn(), originalRender = vi.fn();
  marked.material.onBeforeCompile = originalCompile;
  marked.onBeforeRender = originalRender;
  const originalKey = marked.material.customProgramCacheKey;
  const controlCompile = control.material.onBeforeCompile, controlRender = control.onBeforeRender;
  const shader = { uniforms: {}, fragmentShader: "void main() {\n}" } as Parameters<THREE.Material["onBeforeCompile"]>[0];
  const render = (eye: THREE.Camera) => marked.onBeforeRender(renderer, new THREE.Scene(), eye, marked.geometry, marked.material, root);
  try {
    depth.update(frame, viewer, [root]);
    expect(getDepthInformation.mock.calls.map(([view]) => view)).toEqual(views);
    marked.material.onBeforeCompile(shader, renderer);
    expect(originalCompile).toHaveBeenCalledOnce();
    for (const [i, eye] of eyes.entries()) {
      render(eye);
      expect(shader.uniforms.environmentDepthEnabled.value).toBe(true);
      expect((shader.uniforms.environmentDepthTexture.value as THREE.ExternalTexture).sourceTexture).toBe(textures[i]);
      expect(shader.uniforms.environmentDepthLayer.value).toBe(i);
      expect((shader.uniforms.environmentDepthTransform.value as THREE.Matrix4).elements).toEqual(transforms[i].elements);
      expect(shader.uniforms.environmentDepthViewport.value).toEqual(viewports[i]);
    }
    expect(originalRender).toHaveBeenCalledTimes(2);
    expect(control.material.onBeforeCompile).toBe(controlCompile);
    expect(control.onBeforeRender).toBe(controlRender);
    expect(control.material.depthTest).toBe(false);

    records[1].isValid = false;
    depth.update(frame, viewer, [root]);
    for (const eye of eyes) {
      render(eye);
      expect(shader.uniforms.environmentDepthEnabled.value).toBe(false);
    }
    records[1].isValid = true;
    depth.update(frame, viewer, [root]);
    render(eyes[0]);
    expect(shader.uniforms.environmentDepthEnabled.value).toBe(true);
    depth.reset();
    expect(shader.uniforms.environmentDepthEnabled.value).toBe(false);
    expect(renderer.xr.getDepthSensingMesh).toBe(originalDepthMesh);
  } finally {
    depth.dispose();
    marked.geometry.dispose(); marked.material.dispose();
    control.geometry.dispose(); control.material.dispose();
  }
  expect(marked.material.onBeforeCompile).toBe(originalCompile);
  expect(marked.material.customProgramCacheKey).toBe(originalKey);
  expect(marked.onBeforeRender).toBe(originalRender);
  expect(control.material.onBeforeCompile).toBe(controlCompile);
  expect(control.onBeforeRender).toBe(controlRender);
});
