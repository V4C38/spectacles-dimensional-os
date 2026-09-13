import { describe, expect, it } from "vitest";
import { parsePlaceArMarkerArgs } from "../../Assets/Scripts/DimOSARClient/agent/agentSkills";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import { ARMarkerPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/ARMarkerPresenter";
import { clientTrackingToSpecsPoint } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";

type FakeRoot = SceneObject & {
  worldPosition: vec3;
  destroyed: boolean;
};

function fakeRoot(): FakeRoot {
  const root = {
    enabled: false,
    worldPosition: new vec3(0, 0, 0),
    destroyed: false,
    getTransform() {
      return {
        setWorldPosition: (value: vec3) => {
          root.worldPosition = value;
        },
      };
    },
    getComponent() {
      return { text: "" };
    },
    getChildrenCount() {
      return 0;
    },
    destroy() {
      root.destroyed = true;
    },
  };
  return root as unknown as FakeRoot;
}

function fakePrefab(instances: FakeRoot[]): ObjectPrefab {
  return {
    instantiate() {
      const root = fakeRoot();
      instances.push(root);
      return root;
    },
  } as unknown as ObjectPrefab;
}

const ORIGIN_A: ClientTrackingOrigin = {
  position: [1, 0, 0],
  orientation: [0, 0, 0, 1],
  confidence: 1,
  ts: 1,
};

const ORIGIN_B: ClientTrackingOrigin = {
  position: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  confidence: 1,
  ts: 2,
};

describe("ARMarkerPresenter", () => {
  it("upserts by id, removes, and clears", () => {
    const instances: FakeRoot[] = [];
    const presenter = new ARMarkerPresenter({
      parent: {} as SceneObject,
      markerPrefab: fakePrefab(instances),
    });
    const args = parsePlaceArMarkerArgs({ id: "kitchen", x: 2, y: 0, z: 0, title: "Kitchen" });
    expect(presenter.apply(args, ORIGIN_A).ok).toBe(true);
    expect(presenter.size()).toBe(1);
    expect(instances).toHaveLength(1);
    expect(presenter.apply({ ...args, x: 3, title: "Pantry" }, ORIGIN_A).ok).toBe(true);
    expect(presenter.size()).toBe(1);
    expect(instances).toHaveLength(1);
    presenter.remove("kitchen");
    expect(presenter.size()).toBe(0);
    expect(instances[0].destroyed).toBe(true);
    presenter.apply(args, ORIGIN_A);
    presenter.clearAll();
    expect(presenter.size()).toBe(0);
  });

  it("recompose moves world position when origin changes", () => {
    const instances: FakeRoot[] = [];
    const presenter = new ARMarkerPresenter({
      parent: {} as SceneObject,
      markerPrefab: fakePrefab(instances),
    });
    presenter.apply(parsePlaceArMarkerArgs({ id: "door", x: 2, y: 0, z: 0 }), ORIGIN_A);
    const first = clientTrackingToSpecsPoint([1, 0, 0]);
    expect(instances[0].worldPosition.x).toBeCloseTo(first[0]);
    expect(instances[0].worldPosition.y).toBeCloseTo(first[1]);
    expect(instances[0].worldPosition.z).toBeCloseTo(first[2]);
    presenter.recompose(ORIGIN_B);
    const moved = clientTrackingToSpecsPoint([2, 0, 0]);
    expect(instances[0].worldPosition.x).toBeCloseTo(moved[0]);
    expect(instances[0].worldPosition.y).toBeCloseTo(moved[1]);
    expect(instances[0].worldPosition.z).toBeCloseTo(moved[2]);
  });
});
