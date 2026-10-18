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
      setWorldPosition: vi.fn(),
      setLocalRotation: vi.fn(),
    }),
  } as unknown as SceneObject;
}

describe("NavigationTargetMarker initialization", () => {
  it("initializes the authored button_cancel and binds cancellation when runtime starts", () => {
    const button = { onTriggerUp: { add: vi.fn() }, enabled: true };
    const cancel = node("button_cancel", { RoundButton: button }, [
      node("ButtonVFX_Active"), node("ButtonVFX_Inactive"), node("Text_Title", { "Component.Text": {} }),
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
      node("State_Text", { "Component.Text": {} }),
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
    expect(button.onTriggerUp.add).not.toHaveBeenCalled();
    expect(() => marker.ensureReady()).not.toThrow();
    marker.setPose(new vec3(10, 0, 20), quat.quatIdentity());
    marker.show();
    const onCancel = vi.fn();
    marker.bindEvents({ onCancel });
    marker.setCancelVisible(true);
    expect(root.enabled).toBe(true);
    expect(cancel.enabled).toBe(true);
    expect(button.onTriggerUp.add).toHaveBeenCalledTimes(1);
    button.onTriggerUp.add.mock.calls[0][0]();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
