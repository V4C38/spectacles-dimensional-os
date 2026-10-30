import { expect, it } from "vitest";
import { ArmJointFilter } from "../src/manipulation/ArmJointFilter";
import { ArmTrajectoryProgress } from "../src/manipulation/ArmTrajectoryProgress";
import type {
  ManipulationModel,
  ManipulationPlan,
} from "@dimos-ar-client/manipulation/ManipulationTypes";

const model = {
  joints: [{ name: "joint", kind: "continuous" }],
} as ManipulationModel;

it("smooths measured joints with a 50 ms time constant and resets on context changes", () => {
  const filter = new ArmJointFilter();
  expect(filter.sample(model, { joint: 0 }, "a", 1).joint).toBe(0);
  const input = { joint: 1 };
  expect(filter.sample(model, input, "a", 1.05).joint).toBeCloseTo(
    1 - Math.exp(-1),
  );
  expect(input.joint).toBe(1);
  expect(filter.sample(model, { joint: 2 }, "b", 1.06).joint).toBe(2);
  filter.reset();
  expect(filter.sample(model, { joint: 0 }, "b", 1.07).joint).toBe(0);
  expect(filter.sample(model, { joint: 2 }, "b", 2).joint).toBe(2);
});

it("takes the shortest rotation for continuous joints but respects limited joint travel", () => {
  const filter = new ArmJointFilter();
  filter.sample(model, { joint: Math.PI - 0.01 }, "a", 1);
  const result = filter.sample(
    model,
    { joint: -Math.PI + 0.01 },
    "a",
    1.025,
  ).joint;
  expect(result).toBeGreaterThan(Math.PI - 0.01);
  expect(result).toBeLessThan(Math.PI + 0.01);
  const limited = {
    joints: [{ name: "joint", kind: "revolute" }],
  } as ManipulationModel;
  filter.reset();
  filter.sample(limited, { joint: 2 }, "a", 1);
  expect(filter.sample(limited, { joint: -2 }, "a", 1.05).joint).toBeCloseTo(
    2 - 4 * (1 - Math.exp(-1)),
  );
});

const plan: ManipulationPlan = {
  plan_id: "p",
  duration: 4,
  joint_names: ["joint"],
  trajectory: [0, 1, 2, 1, 0].map((q, time) => ({ time, positions: [q] })),
};

it("trims by measured progress, stays still on pauses, and does not jump to a later repeated pose", () => {
  const progress = new ArmTrajectoryProgress();
  const advance = (joint: number) =>
    progress.advance(plan, { joint }, new Set(), "op");
  expect(advance(0.5)).toBeCloseTo(0.5);
  expect(advance(0.5)).toBeCloseTo(0.5);
  expect(advance(0.2)).toBeCloseTo(0.5);
  expect(advance(1.5)).toBeCloseTo(1.5);
  expect(advance(2)).toBeCloseTo(2);
  expect(advance(1.5)).toBeCloseTo(2.5);
  expect(progress.advance(plan, {}, new Set(), "op")).toBeCloseTo(2.5);
  expect(progress.advance(plan, { joint: 0 }, new Set(), "new-op")).toBe(0);
});

it("handles zero-length trajectory segments and continuous joint wraparound", () => {
  const progress = new ArmTrajectoryProgress();
  const dwell = {
    ...plan,
    trajectory: [
      { time: 0, positions: [0] },
      { time: 1, positions: [0] },
      { time: 2, positions: [1] },
    ],
  };
  expect(progress.advance(dwell, { joint: 0.5 }, new Set(), "a")).toBeCloseTo(
    1.5,
  );
  const wrapped = {
    ...plan,
    trajectory: [
      { time: 0, positions: [Math.PI - 0.1] },
      { time: 1, positions: [-Math.PI + 0.1] },
    ],
  };
  expect(
    progress.advance(wrapped, { joint: Math.PI }, new Set(["joint"]), "b"),
  ).toBeCloseTo(0.5);
});

it("advances through a reversal even when low-rate feedback misses the exact turning point", () => {
  const progress = new ArmTrajectoryProgress();
  expect(progress.advance(plan, {joint: 1.9}, new Set(), "op")).toBeCloseTo(1.9);
  expect(progress.advance(plan, {joint: 1.8}, new Set(), "op")).toBeCloseTo(2.2);
});
