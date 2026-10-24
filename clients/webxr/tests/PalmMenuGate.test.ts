import * as THREE from "three";
import { expect, it } from "vitest";
import { PalmMenuGate, palmUpDot } from "../src/input/PalmMenuGate";

it("requires a deliberate palm-up pose and debounces opening and closing", () => {
  const gate = new PalmMenuGate();
  gate.update(0.7, 0); gate.update(0.7, 1); expect(gate.isOpen).toBe(false);
  gate.update(1, 2); gate.update(1, 2.34); expect(gate.isOpen).toBe(false);
  gate.update(1, 2.36); expect(gate.isOpen).toBe(true);
  gate.update(0.6, 3); expect(gate.isOpen).toBe(true);
  gate.update(null, 4); gate.update(null, 4.17); expect(gate.isOpen).toBe(true);
  gate.update(null, 4.19); expect(gate.isOpen).toBe(false);
});

it.each(["left", "right"] as const)("uses handedness-correct metacarpals and rejects bent %s palms", hand => {
  const joints = new Map<string, THREE.Vector3>([
    ["wrist", new THREE.Vector3()], ["middle-finger-metacarpal", new THREE.Vector3(0, 0, -0.04)],
    ["index-finger-metacarpal", new THREE.Vector3(hand === "right" ? 0.02 : -0.02, 0, -0.04)],
    ["pinky-finger-metacarpal", new THREE.Vector3(hand === "right" ? -0.02 : 0.02, 0, -0.04)],
  ]);
  for (const finger of ["middle", "ring"]) {
    joints.set(`${finger}-finger-phalanx-proximal`, new THREE.Vector3(0, 0, -0.06));
    joints.set(`${finger}-finger-phalanx-intermediate`, new THREE.Vector3(0, 0, -0.08));
    joints.set(`${finger}-finger-tip`, new THREE.Vector3(0, 0, -0.1));
  }
  expect(palmUpDot(hand, joints)).toBe(1);
  joints.set("middle-finger-tip", new THREE.Vector3(0, -0.01, -0.075));
  expect(palmUpDot(hand, joints)).toBe(0);
  expect(palmUpDot(hand, new Map())).toBeNull();
});
