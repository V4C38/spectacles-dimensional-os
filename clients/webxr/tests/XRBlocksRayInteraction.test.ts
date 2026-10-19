// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  class AudioContextStub {
    destination = {};
    createGain() { return { connect() {}, gain: { value: 1 } }; }
  }
  Object.defineProperty(window, "AudioContext", { value: AudioContextStub, configurable: true });
});
import * as THREE from "three";
import * as xb from "xrblocks";
import { XRBlocksRayInteraction, registerRayTarget } from "../src/input/XRBlocksRayInteraction";

function fixture() {
  const scene = new THREE.Scene();
  const input = new xb.Input();
  const controllers = [new THREE.Group(), new THREE.Group()];
  const systemsGroup = new THREE.Group();
  scene.add(systemsGroup);
  input.init({ scene, systemsGroup, options: new xb.Options(), renderer: {
    xr: { getController: (i: number) => controllers[i] },
  } as unknown as THREE.WebGLRenderer });
  input.addReticles();
  const controller = input.controllers[0];
  const rig = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  rig.name = "Controller shell at 2cm";
  rig.position.z = -0.02;
  controller.add(rig);
  const button = new xb.TextButton({ text: "Select", width: 0.2, height: 0.1 });
  button.updateLayouts();
  button.position.z = -1;
  scene.add(button);
  scene.updateMatrixWorld(true);
  const user = new xb.User();
  user.init({ input, scene });
  return { scene, input, controller, rig, button, user };
}

it("reproduces the 2cm self-hit in the installed XR Blocks input pipeline", () => {
  const f = fixture();
  f.input.updateController(f.controller);
  const hit = f.input.intersectionsForController.get(f.controller)![0];
  expect(hit.object).toBe(f.rig);
  expect(hit.distance).toBeCloseTo(0.02);
  expect(f.button.ux.isHovered()).toBe(false);
});

for (const distance of [0.02, 0.05, 0.4, 1, 5, 15]) {
  it(`uses the SDK hit, reticle, hover and button activation at ${distance}m despite a rig self-hit`, () => {
    const f = fixture();
    const interaction = new XRBlocksRayInteraction(f.input);
    registerRayTarget(f.button.mesh!);
    f.button.position.z = -distance;
    f.controller.inputSource = { targetRayMode: "tracked-pointer" };
    f.controller.userData.connected = true;
    interaction.setEnabled(true);
    const pressed = vi.fn();
    f.button.onTriggered = pressed;
    f.scene.updateMatrixWorld(true);
    f.input.updateController(f.controller);
    expect(interaction.hit(f.controller)?.object).toBe(f.button.mesh);
    expect(interaction.hit(f.controller)?.distance).toBeCloseTo(distance);
    expect(f.button.ux.isHovered()).toBe(true);
    interaction.update();
    expect(interaction.beams.get(f.controller)?.scale.z).toBeCloseTo(distance);
    expect(f.controller.reticle!.position.z).toBeCloseTo(-distance);
    f.input.defaultOnSelectStart({ type: "selectstart", target: f.controller });
    f.user.onSelectStart({ target: f.controller });
    f.input.updateController(f.controller);
    expect(f.button.ux.isSelected()).toBe(true);
    f.input.defaultOnSelectEnd({ type: "selectend", target: f.controller });
    f.user.onSelectEnd({ target: f.controller });
    expect(pressed).toHaveBeenCalledOnce();
    interaction.dispose();
  });
}

for (const distance of [0.05, 5]) {
it(`uses the same SDK path for a 3D mesh at ${distance}m, hidden UI, empty rays and reconnects`, () => {
  const f = fixture();
  const interaction = new XRBlocksRayInteraction(f.input);
  const target = new xb.MeshScript(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
  target.position.z = -(distance + 0.1);
  f.scene.add(target);
  registerRayTarget(target);
  registerRayTarget(f.button.mesh!);
  f.button.visible = false;
  const selected = vi.fn();
  target.onObjectSelectStart = selected;
  f.controller.inputSource = { targetRayMode: "tracked-pointer" };
  f.controller.userData.connected = true;
  interaction.setEnabled(true);
  f.scene.updateMatrixWorld(true);
  f.input.updateController(f.controller);
  expect(interaction.hit(f.controller)?.object).toBe(target);
  expect(interaction.hit(f.controller)?.distance).toBeCloseTo(distance);
  f.input.defaultOnSelectStart({ type: "selectstart", target: f.controller });
  f.user.onSelectStart({ target: f.controller });
  expect(selected).toHaveBeenCalledOnce();
  target.visible = false;
  f.input.updateController(f.controller);
  interaction.update();
  expect(interaction.hit(f.controller)).toBeUndefined();
  expect(interaction.beams.get(f.controller)?.scale.z).toBe(3);
  f.controller.userData.connected = false;
  interaction.update();
  expect(interaction.beams.get(f.controller)?.visible).toBe(false);
  f.controller.userData.connected = true;
  f.input.updateController(f.controller);
  interaction.update();
  expect(interaction.beams.get(f.controller)?.visible).toBe(true);
  interaction.dispose();
});
}
