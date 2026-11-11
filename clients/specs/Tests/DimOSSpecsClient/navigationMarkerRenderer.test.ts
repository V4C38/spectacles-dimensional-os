import { afterEach, expect, it, vi } from "vitest";
import { NavigationMarkerRenderer } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavigationMarkerRenderer";

const meshes = vi.hoisted(() => new Map<string, any>());
vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer", async importOriginal => {
  const actual = await importOriginal<typeof import("../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer")>();
  class Mesh {
    object = { enabled: false, getTransform: () => ({ setLocalPosition: vi.fn() }) };
    triangles = vi.fn(() => { this.object.enabled = true; });
    segments = vi.fn(() => { this.object.enabled = true; });
    hide() { this.object.enabled = false; }
    setViewportHeight = vi.fn();
    constructor(_parent: SceneObject, name: string) { meshes.set(name, this); }
  }
  return { ...actual, WorldMeshRenderer: Mesh, AdaptiveStrokeRenderer: Mesh };
});

afterEach(() => { meshes.clear(); vi.unstubAllGlobals(); });

it.each([false, true])("keeps a yellow heading for a remote owner with aiming=%s", aiming => {
  vi.stubGlobal("scene", { createSceneObject: () => ({ setParent: vi.fn() }) });
  const renderer = new NavigationMarkerRenderer({} as SceneObject);
  const style = { selected: false, blocked: true, dragging: false, following: false,
    aiming, flash: null, feedbackProgress: 0 };
  renderer.apply(style, 1, 1024);
  const heading = meshes.get("NavigationHeading");
  expect(heading.object.enabled).toBe(true);
  expect(heading.triangles.mock.lastCall[2].slice(0, 3)).toEqual([1, 0.8, 0]);
  expect(meshes.get("NavigationOutcomeGlyph").object.enabled).toBe(false);
  if (aiming) {
    expect(meshes.get("NavigationDraftCircle").segments.mock.lastCall[6]).toEqual([1, 0.8, 0]);
  } else {
    expect(meshes.get("NavigationCircle").triangles.mock.lastCall[2].slice(0, 3)).toEqual([1, 0.8, 0]);
  }
  renderer.apply({ ...style, blocked: false }, 1, 1024);
  expect(heading.triangles.mock.lastCall[2].slice(0, 3)).toEqual([1, 1, 1]);
});
