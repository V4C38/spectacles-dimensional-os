import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gripperJointValues } from "../src/manipulation/ArmToolKinematics";
import {
  composePose,
  linkPoses,
} from "@dimos-ar-client/manipulation/ModelKinematics";
import { armMaterial } from "../src/manipulation/ArmMaterial";
import { OPENYAM_FOREARM_BOXES } from "../src/manipulation/profiles/OpenYAMVisualProfile";

const fixture = JSON.parse(
  readFileSync(
    new URL("./integration-tests/fixtures/OpenYAM.json", import.meta.url),
    "utf8",
  ),
);
const model = fixture.model;
const group = {
  id: "arm",
  joint_names: Object.keys(fixture.joints).filter((name) =>
    name.startsWith("yam_joint"),
  ),
  base_frame: "base",
  tip_frame: "gripper_tip",
  has_gripper: true,
  following: true,
};
it("opens OpenYAM fingers toward the lower limits and preserves arm joints", () => {
  const widths: number[] = [];
  for (const opening of [0, 0.5, 1]) {
    const values = gripperJointValues(model, group, opening);
    expect(Object.keys(values).sort()).toEqual(["joint7", "joint8"]);
    for (const name of Object.keys(values)) {
      const joint = model.joints.find((j: any) => j.name === name);
      expect(values[name]).toBeCloseTo(
        joint.limits.upper -
          (joint.limits.upper - joint.limits.lower) * opening,
      );
    }
    const poses = linkPoses(model, { ...fixture.joints, ...values });
    // The finger meshes cross their joint origins. Measure distal pad points,
    // rather than the distance between joint frames (which shrinks as pads open).
    const left = composePose(poses.tip_left, {
      position: [0.0239931, -0.0472521, -0.085],
      orientation: [0, 0, 0, 1],
    });
    const right = composePose(poses.tip_right, {
      position: [-0.0239931, 0.0472521, -0.085],
      orientation: [0, 0, 0, 1],
    });
    widths.push(
      Math.hypot(
        ...left.position.map((v: number, i: number) => v - right.position[i]),
      ),
    );
  }
  expect(widths[0]).toBeLessThan(widths[1]);
  expect(widths[1]).toBeLessThan(widths[2]);
});
it("makes the forearm envelope substantially smaller with two simple boxes", () => {
  const bounds = model.links.find((l: any) => l.name === "link3").bounds;
  const volume = (s: number[]) => s.reduce((a, b) => a * b, 1);
  const compound = OPENYAM_FOREARM_BOXES.reduce(
    (n, b) => n + volume(b.size),
    0,
  );
  expect(compound).toBeLessThan(volume(bounds.size) * 0.55);
});
it("preserves the arm material's edge opacity while lowering its center", () => {
  for (const thin of [false, true]) {
    const material = armMaterial(thin),
      u = material.uniforms;
    expect(u.uFill.value).toBe(thin ? 0.008 : 0.015);
    expect(u.uFill.value + u.uRim.value).toBeCloseTo(thin ? 0.82 : 0.92);
    expect(u.uPower.value).toBe(5);
    material.dispose();
  }
});

it("keeps articulation unchanged when the model asset moves", () => {
  const moved = { ...model, asset_url: "/cdn/renamed-arm.glb" };
  expect(gripperJointValues(moved, group, 0.7)).toEqual(
    gripperJointValues(model, group, 0.7),
  );
});
