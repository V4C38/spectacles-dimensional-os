import { beforeEach, describe, expect, it, vi } from "vitest";
import { setMockTime } from "../setup/lens-globals";
import { setMockHand, setMockHands } from "../mocks/HandInputData";
import { WristMenuController } from "../../Assets/Scripts/DimOSSpecsClient/presentation/WristMenuController";

function sceneObject(): SceneObject {
  const position = new vec3();
  let rotation = quat.quatIdentity();
  const object = {
    enabled: true,
    getTransform: () => ({
      getWorldPosition: () => position,
      getWorldRotation: () => rotation,
      setWorldRotation: (next: quat) => { rotation = next; },
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
  it("summons from the right hand and pins on tracking loss", () => {
    let tracked = true;
    setMockHands({ right: { isTracked: () => tracked, getPalmPitchAngle: () => 45, isFacingCamera: () => true } });
    let hides = 0;
    const controller = new WristMenuController({ panel: sceneObject(), anchorRoot: sceneObject(),
      onMenuShow: () => {}, onMenuHide: () => { hides++; } });
    controller.tick(0.016); setMockTime(0.3); controller.tick(0.016);
    expect(controller.sourceHand()).toBe("right");
    tracked = false; controller.tick(0.016);
    expect(controller.isPinned()).toBe(true); expect(hides).toBe(1);
  });

  it("leaves a grabbed panel pinned after a palm summons it", () => {
    setMockHands({ left: { isTracked: () => true, getPalmPitchAngle: () => 45, isFacingCamera: () => true } });
    const panel = sceneObject(), anchor = sceneObject();
    const controller = new WristMenuController({ panel, anchorRoot: anchor,
      onMenuShow: () => {}, onMenuHide: () => {} });
    controller.tick(0.016); setMockTime(0.3); controller.tick(0.016);
    controller.pin();
    // Native border grabbing owns the detached world pose.
    panel.getTransform().setWorldPosition(new vec3(9, 8, 7));
    anchor.getTransform().setWorldPosition(new vec3(100, 200, 300));
    controller.tick(0.016);
    expect(panel.getTransform().getWorldPosition()).toEqual(new vec3(9, 8, 7));
  });

  it("keeps a grabbed panel pinned when the source palm turns away", () => {
    let facing = true;
    setMockHands({ left: { isTracked: () => true, getPalmPitchAngle: () => facing ? 45 : -80, isFacingCamera: () => facing } });
    let hides = 0;
    const controller = new WristMenuController({ panel: sceneObject(), anchorRoot: sceneObject(),
      onMenuShow: () => {}, onMenuHide: () => { hides++; } });
    controller.tick(0.016); setMockTime(0.3); controller.tick(0.016); controller.pin();
    facing = false; controller.tick(0.016); setMockTime(0.5); controller.tick(0.016);
    expect(controller.isPinned()).toBe(true); expect(hides).toBe(1);
    controller.closeImmediate(); expect(controller.isPinned()).toBe(false); expect(hides).toBe(2);
  });

});

it.each([15, 30, 60])("smoothly follows only the summoning wrist at %s fps", fps => {
  setMockTime(0);
  const wrist = { x: 0, y: 0, z: -60 };
  setMockHands({ left: { isTracked: () => true, getPalmPitchAngle: () => 45, isFacingCamera: () => true, wrist: { position: wrist } } });
  const panel = sceneObject();
  const controller = new WristMenuController({ panel, anchorRoot: sceneObject(), onMenuShow() {}, onMenuHide() {} });
  controller.tick(1 / fps); setMockTime(.3); controller.tick(1 / fps);
  wrist.x = 10;
  for (let i = 0; i < fps / 3; i++) controller.tick(1 / fps);
  expect(panel.getTransform().getWorldPosition().x).toBeGreaterThan(9.8);
  expect(panel.getTransform().getWorldPosition().x).toBeLessThan(10);
  expect(panel.getTransform().getWorldPosition().y).toBe(20);
  controller.pin(); wrist.x = 100;
  const pinned = panel.getTransform().getWorldPosition().x;
  controller.tick(1 / fps);
  expect(panel.getTransform().getWorldPosition().x).toBe(pinned);
});

it("freezes the summon offset so head motion only changes its billboard", () => {
  setMockTime(0);
  const nativeLookAt = (quat as any).lookAt;
  (quat as any).lookAt = vi.fn(() => quat.quatIdentity());
  try {
    const wrist = { x: 0, y: 0, z: -60 };
    setMockHands({ left: { isTracked: () => true, getPalmPitchAngle: () => 45, isFacingCamera: () => true, wrist: { position: wrist } } });
    const panel = sceneObject(), camera = sceneObject();
    const controller = new WristMenuController({ panel, anchorRoot: sceneObject(), cameraObject: camera, onMenuShow() {}, onMenuHide() {} });
    controller.tick(.016); setMockTime(.3); controller.tick(.016);
    expect(panel.getTransform().getWorldPosition()).toEqual(new vec3(0, 20, -78));
    camera.getTransform().setWorldPosition(new vec3(30, 0, 0));
    camera.getTransform().setWorldRotation(new quat(Math.SQRT1_2, 0, Math.SQRT1_2, 0));
    controller.tick(.1);
    expect(panel.getTransform().getWorldPosition()).toEqual(new vec3(0, 20, -78));
    expect((quat as any).lookAt).toHaveBeenCalled();
  } finally { (quat as any).lookAt = nativeLookAt; }
});
