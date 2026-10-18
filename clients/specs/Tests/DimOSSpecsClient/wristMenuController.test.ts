import { beforeEach, describe, expect, it } from "vitest";
import { setMockTime } from "../setup/lens-globals";
import { setMockHand } from "../mocks/HandInputData";
import { WristMenuController } from "../../Assets/Scripts/DimOSSpecsClient/presentation/WristMenuController";

function sceneObject(): SceneObject {
  const position = new vec3();
  const object = {
    enabled: true,
    getTransform: () => ({
      getWorldPosition: () => position,
      setWorldPosition: (next: vec3) => {
        position.x = next.x;
        position.y = next.y;
        position.z = next.z;
      },
    }),
  };
  return object as unknown as SceneObject;
}

describe("WristMenuController", () => {
  beforeEach(() => {
    setMockTime(0);
    setMockHand(null);
  });

  it("opens again from the same palm pose after an external close", () => {
    setMockHand({
      isTracked: () => true,
      getPalmPitchAngle: () => 45,
      isFacingCamera: () => true,
      handType: "left",
    });
    const panel = sceneObject();
    let shows = 0;
    const controller = new WristMenuController({
      panel,
      anchorRoot: sceneObject(),
      onMenuShow: () => {
        shows += 1;
        panel.enabled = true;
      },
      onMenuHide: () => {
        panel.enabled = false;
      },
    });

    controller.tick(0.016);
    setMockTime(0.29);
    controller.tick(0.016);
    expect(shows).toBe(1);
    expect(panel.enabled).toBe(true);

    controller.closeImmediate();
    expect(panel.enabled).toBe(false);

    setMockTime(0.3);
    controller.tick(0.016);
    expect(shows).toBe(1);
    setMockTime(0.59);
    controller.tick(0.016);
    expect(shows).toBe(2);
    expect(panel.enabled).toBe(true);
  });
});
