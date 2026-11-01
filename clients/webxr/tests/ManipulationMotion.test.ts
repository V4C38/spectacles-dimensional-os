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

it("interpolates measured updates using their interval", () => {
 const f=new ArmJointFilter();f.sample(model,{joint:0},"a",0);
 expect(f.sample(model,{joint:1},"a",.1).joint).toBe(0);
 expect(f.sample(model,{joint:1},"a",.125).joint).toBeCloseTo(.5);
 expect(f.sample(model,{joint:1},"a",.2).joint).toBeCloseTo(1);
 expect(f.sample(model,{joint:2},"b",.3).joint).toBe(2);
});
it("continuous joints cross the short arc",()=>{
 const f=new ArmJointFilter();f.sample(model,{joint:Math.PI-.1},"a",0);
 f.sample(model,{joint:-Math.PI+.1},"a",.1);
 expect(f.sample(model,{joint:-Math.PI+.1},"a",.125).joint).toBeCloseTo(Math.PI);
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
