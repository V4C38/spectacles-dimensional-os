import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("requireAsset", () => ({ mainPass: {} }));
});

import { NavGoalMarker } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavGoalMarker";

function node(name: string, components: Record<string, unknown> = {}, children: SceneObject[] = []): SceneObject {
  return {
    name,
    enabled: true,
    getChildrenCount: () => children.length,
    getChild: (index: number) => children[index],
    getComponent: (type: string) => components[type] ?? null,
    getTransform: () => ({
      getLocalScale: () => vec3.one(),
      setLocalScale: vi.fn(),
      setLocalPosition: vi.fn(),
      setWorldPosition: vi.fn(),
      setLocalRotation: vi.fn(),
    }),
  } as unknown as SceneObject;
}

describe("NavigationTargetMarker initialization", () => {
  it("initializes native cancellation without legacy VFX children", () => {
    const button = { onTriggerDown: { add: vi.fn() }, onTriggerUp: { add: vi.fn() }, enabled: true, inactive: false };
    const cancel = node("button_cancel", { RoundButton: button }, [
      node("Text_Title", { "Component.Text": {} }),
    ]);
    const visual = () => ({ mainMaterial: { mainPass: {} } });
    const root = node("NavigationTargetMarker", {}, [
      node("DragInteractable", { Interactable: {
        onTriggerStart: { add: vi.fn() },
        onTriggerEnd: { add: vi.fn() },
        onTriggerCanceled: { add: vi.fn() },
      } }, [node("HintAnchor")]),
      cancel,
      node("NavigationHeadingRoot"),
      node("Visual", { "Component.RenderMeshVisual": visual() }),
      node("MoveDirectionArrow", { "Component.RenderMeshVisual": visual() }),
      node("Dots", { "Component.RenderMeshVisual": visual() }),
    ]);
    const marker = Object.assign(new NavGoalMarker(), { getSceneObject: () => root });
    // ObjectPrefab calls onAwake while children are still being constructed.
    const lifecycle = marker as unknown as { onAwake?: () => void };
    lifecycle.onAwake?.();
    expect(root.enabled).toBe(true);
    expect(cancel.enabled).toBe(true);
    expect(button.onTriggerDown.add).not.toHaveBeenCalled();
    expect(() => marker.ensureReady()).not.toThrow();
    marker.setPose(new vec3(10, 0, 20), quat.quatIdentity());
    marker.show();
    const onCancel = vi.fn();
    marker.bindEvents({ onCancel });
    marker.setCancelVisible(true);
    expect(root.enabled).toBe(true);
    expect(cancel.enabled).toBe(true);
    expect(button.onTriggerDown.add).toHaveBeenCalledTimes(1);
    expect(button.onTriggerUp.add).not.toHaveBeenCalled();
    button.onTriggerDown.add.mock.calls[0][0]();
    expect(onCancel).toHaveBeenCalledTimes(1);
    marker.setCancelVisible(true, false);
    expect(button.inactive).toBe(true);
    marker.setCancelVisible(true, true);
    expect(button.inactive).toBe(false);
  });
});

it("keeps the marker cancel button out of floor-drag capture", () => {
  const root = { getParent: () => null } as unknown as SceneObject;
  const drag = { getParent: () => root } as unknown as SceneObject;
  const cancel = { getParent: () => root } as unknown as SceneObject;
  const dragChild = { getParent: () => drag } as unknown as SceneObject;
  const marker = Object.assign(new NavGoalMarker(), { root, dragObject: drag });
  expect(marker.ownsDragTarget(drag)).toBe(true);
  expect(marker.ownsDragTarget(dragChild)).toBe(true);
  expect(marker.ownsDragTarget(cancel)).toBe(false);
  expect(marker.ownsDragTarget(root)).toBe(false);
});

it("limits marker hit priority to its enabled hierarchy while including Cancel", () => {
  const root = { isEnabledInHierarchy: true, getParent: () => null } as unknown as SceneObject;
  const child = { getParent: () => root } as unknown as SceneObject;
  const other = { getParent: () => null } as unknown as SceneObject;
  const marker = Object.assign(new NavGoalMarker(), { root });
  expect(marker.ownsInteractionTarget(child)).toBe(true);
  expect(marker.ownsInteractionTarget(other)).toBe(false);
  (root as any).isEnabledInHierarchy = false;
  expect(marker.ownsInteractionTarget(child)).toBe(false);
});

it("centers a four-centimetre hit cylinder on the filled circle with an edge margin", () => {
  const setWorldScale = vi.fn(), setWorldPosition = vi.fn(), setWorldRotation = vi.fn();
  const marker = Object.assign(new NavGoalMarker(), { root: {},
    worldVisuals: { setRadius: vi.fn(), apply: vi.fn(), circleBounds: () => ({ radius: 26, center: [10, 1.5, -20] }) },
    dragCollider: { shape: { radius: 40, length: 5 } },
    dragObject: { getTransform: () => ({ getWorldScale: () => new vec3(0.4, 0.4, 0.4), getWorldPosition: () => vec3.zero(), getWorldRotation: () => quat.quatIdentity(), setWorldScale, setWorldPosition, setWorldRotation }) },
  });
  marker.applyWorldStyle({ selected: true, dragging: false, following: false, aiming: false,
    flash: null, feedbackProgress: 0 }, 1 / 60, 1024);
  expect(setWorldScale).toHaveBeenCalledWith(new vec3(0.7, 0.4, 0.7));
  expect(setWorldPosition).toHaveBeenCalledWith(new vec3(10, 1.5, -20));
  expect(setWorldRotation).not.toHaveBeenCalled(); // Already horizontal; no physics transform churn.
  expect((marker as any).dragCollider.shape.length * 0.4).toBe(4);
});

it("rises and grows the authored cancel button with its connector without restarting on repeated snapshots", () => {
  let position = vec3.zero(), scale = vec3.zero();
  const worldVisuals = { setRadius: vi.fn(), apply: vi.fn(), circleBounds: () => ({ radius: 21.44 }), circleHeightCm: () => 1.5 };
  const marker = Object.assign(new NavGoalMarker(), { root: {}, worldVisuals, cancelBaseScale: new vec3(2.49, 2.49, 2.49),
    cancelObject: { enabled: false, getTransform: () => ({ setLocalPosition: (p: vec3) => { position = p; }, setLocalScale: (s: vec3) => { scale = s; } }) },
    cancelButton: { enabled: false, inactive: false }, interactionsBound: true });
  const style = { selected: false, dragging: false, following: true, aiming: false, cancelVisible: true, flash: null, feedbackProgress: 0 };
  marker.setCancelVisible(true);
  expect(position.y).toBeCloseTo(1.5); expect(scale.x).toBe(0);
  marker.applyWorldStyle(style, 0.14, 1024);
  expect(position.y).toBeCloseTo((1.5 + 38) / 2); expect(scale.x).toBeCloseTo(2.49 / 2);
  expect(worldVisuals.apply.mock.lastCall?.[0].cancelProgress).toBeCloseTo(0.5);
  marker.setCancelVisible(true); marker.applyWorldStyle(style, 0.14, 1024);
  expect(position.y).toBeCloseTo(38); expect(scale.x).toBeCloseTo(2.49);
  marker.setCancelVisible(true, true, 1);
  expect(position.y).toBeCloseTo(1.5); expect(scale.x).toBe(0);
  marker.applyWorldStyle(style, 0.14, 1024);
  marker.setCancelVisible(true, true, 1);
  expect(position.y).toBeCloseTo((1.5 + 38) / 2);
  marker.applyWorldStyle(style, 0.14, 1024);
  expect(position.y).toBeCloseTo(38);
  marker.setCancelVisible(false); marker.setCancelVisible(true);
  expect(position.y).toBeCloseTo(1.5); expect(scale.x).toBe(0);
});
