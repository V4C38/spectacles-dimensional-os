import { expect, it } from "vitest";
import {
  linkPoses,
  samplePlan,
} from "../../../Assets/Scripts/DimOSARClient/manipulation/ModelKinematics";
import type { ManipulationModel } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes";

it("handles non-OpenYAM joint names, prismatic motion, rotations, and mimic joints", () => {
  const model: ManipulationModel = {
    revision: "fixture",
    root: "base",
    asset_url: null,
    links: ["base", "carriage", "wrist", "finger"].map((name) => ({
      name,
      bounds: null,
    })),
    joints: [
      {
        name: "slide",
        kind: "prismatic",
        parent: "base",
        child: "carriage",
        origin: { position: [1, 0, 0], orientation: [0, 0, 0, 1] },
        axis: [0, 0, 1],
        mimic: null,
      },
      {
        name: "turn",
        kind: "revolute",
        parent: "carriage",
        child: "wrist",
        origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
        axis: [0, 0, 1],
        mimic: null,
      },
      {
        name: "follower",
        kind: "prismatic",
        parent: "wrist",
        child: "finger",
        origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
        axis: [1, 0, 0],
        mimic: { joint: "slide", multiplier: 0.5, offset: 0 },
      },
    ],
  };
  const poses = linkPoses(model, { slide: 0.4, turn: Math.PI / 2 });
  expect(poses.carriage.position).toEqual([1, 0, 0.4]);
  expect(poses.finger.position[0]).toBeCloseTo(1);
  expect(poses.finger.position[1]).toBeCloseTo(0.2);
});
it("samples timing rather than waypoint rank", () => {
  const values = samplePlan(
    {
      plan_id: "p",
      joint_names: ["x"],
      duration: 4,
      trajectory: [
        { time: 0, positions: [0] },
        { time: 1, positions: [2] },
        { time: 4, positions: [3] },
      ],
    },
    2.5,
  );
  expect(values.x).toBeCloseTo(2.5);
});
