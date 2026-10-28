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
