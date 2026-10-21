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
    expect(interaction.beams.get(f.controller)?.tip.z).toBeCloseTo(-distance);
    expect(interaction.beams.get(f.controller)?.opacity).toBe(1);
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
  for (let i = 0; i < 240; i++) interaction.update(1 / 60);
  expect(interaction.beams.get(f.controller)?.tip.z).toBeCloseTo(-3, 3);
  expect(interaction.beams.get(f.controller)?.opacity).toBeCloseTo(0.5, 3);
  f.controller.userData.connected = false;
  interaction.update();
  expect(interaction.beams.get(f.controller)?.mesh.visible).toBe(false);
  f.controller.userData.connected = true;
  f.input.updateController(f.controller);
  interaction.update();
  expect(interaction.beams.get(f.controller)?.mesh.visible).toBe(true);
  interaction.dispose();
});
}

it("bends the laser toward a smoothed tip and dims it until it hovers a target", () => {
  const f = fixture();
  const interaction = new XRBlocksRayInteraction(f.input);
  registerRayTarget(f.button.mesh!);
  f.button.position.z = -1;
  f.controller.inputSource = { targetRayMode: "tracked-pointer" };
  f.controller.userData.connected = true;
  interaction.setEnabled(true);
  f.scene.updateMatrixWorld(true);
  f.input.updateController(f.controller);
  interaction.update(1 / 60);
  const beam = interaction.beams.get(f.controller)!;
  expect(beam.tip.z).toBeCloseTo(-1);
  f.button.visible = false;
  f.input.updateController(f.controller);
  interaction.update(1 / 60);
  expect(beam.tip.z).toBeLessThan(-1);
  expect(beam.tip.z).toBeGreaterThan(-3);
  expect(beam.opacity).toBeLessThan(1);
  expect(beam.mesh.material.uniforms.uP1.value.z).toBeCloseTo(beam.mesh.material.uniforms.uP2.value.z / 2);
  let previous = beam.tip.z;
  for (let i = 0; i < 120; i++) {
    interaction.update(1 / 60);
    expect(beam.tip.z).toBeLessThanOrEqual(previous);
    expect(beam.tip.z).toBeGreaterThanOrEqual(-3);
    previous = beam.tip.z;
  }
  const smoothed = interaction.smoothedRay(f.controller);
  expect(smoothed.direction[2]).toBeCloseTo(-1);
  interaction.dispose();
});

it("hides an idle laser unless the hand is held out, zooming it in and out", () => {
  const f = fixture();
  const interaction = new XRBlocksRayInteraction(f.input);
  f.controller.inputSource = { targetRayMode: "tracked-pointer" };
  f.controller.userData.connected = true;
  interaction.setEnabled(true);
  f.scene.updateMatrixWorld(true);
  f.input.updateController(f.controller);
  const resting = { position: new THREE.Vector3(0, 0.3, -0.1), quaternion: new THREE.Quaternion() };
  interaction.update(1 / 60, resting);
  const beam = interaction.beams.get(f.controller)!;
  expect(beam.mesh.visible).toBe(false);
  const head = { position: new THREE.Vector3(0, 0.3, 0.4), quaternion: new THREE.Quaternion() };
  interaction.update(1 / 60, head);
  expect(beam.mesh.visible).toBe(true);
  const growing = beam.mesh.material.uniforms.uP2.value.z;
  expect(growing).toBeGreaterThan(-3);
  for (let i = 0; i < 20; i++) interaction.update(1 / 60, head);
  expect(beam.mesh.material.uniforms.uP2.value.z).toBeCloseTo(-3);
  expect(beam.reveal).toBe(1);
  interaction.update(1 / 60, resting);
  expect(beam.reveal).toBeLessThan(1);
  for (let i = 0; i < 20; i++) interaction.update(1 / 60, resting);
  expect(beam.mesh.visible).toBe(false);
  registerRayTarget(f.button.mesh!);
  f.input.updateController(f.controller);
  for (let i = 0; i < 20; i++) interaction.update(1 / 60, resting);
  expect(beam.mesh.visible).toBe(true);
  interaction.dispose();
});
