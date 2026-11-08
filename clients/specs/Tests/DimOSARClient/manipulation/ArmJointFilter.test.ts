import { expect, it } from "vitest";
import { ArmJointFilter, armMotionContext, sameArmTrackingOrigin } from "../../../Assets/Scripts/DimOSARClient/manipulation/ArmJointFilter";
import { ARM_PANEL_STYLE, clampArmPanelScale } from "../../../Assets/Scripts/DimOSARClient/presentation/PanelFrameStyle";
import type { ManipulationModel } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes";

const model = { joints: [{ name: "j", kind: "revolute", limits: { lower: -2, upper: 2 } }] } as ManipulationModel;
it("retargets without a position or velocity discontinuity and settles within 80 ms", () => {
  const f=new ArmJointFilter(); f.sample(model,{j:0},"a",0);
  f.sample(model,{j:1},"a",.1);
  const before=f.sample(model,{j:1},"a",.125-1e-6).j;
  const at=f.sample(model,{j:1},"a",.125).j;
  expect(f.sample(model,{j:-1},"a",.125).j).toBeCloseTo(at,8);
  const after=f.sample(model,{j:-1},"a",.125+1e-6).j;
  expect((after-at)/1e-6).toBeCloseTo((at-before)/1e-6,1);
  expect(f.sample(model,{j:-1},"a",.21).j).toBeCloseTo(-1);
});
it.each([30,60,90,120])("keeps measured velocity continuous at %i render Hz with less than 40 ms lag", hz => {
  const f=new ArmJointFilter(); let stamp=0, raw=0;
  const velocities:number[]=[]; let last=0;
  for(let frame=0;frame<=hz*2;frame++) {
    const now=frame/hz;
    if(now-stamp>=1/30-1e-8) { stamp=now; raw=.5*now; }
    const q=f.sample(model,{j:raw},"a",now,1/30,stamp,{j:.5}).j;
    if(now>.3) { expect(Math.abs(q-.5*now)).toBeLessThan(.5*.04); velocities.push((q-last)*hz); }
    last=q;
  }
  expect(Math.max(...velocities)-Math.min(...velocities)).toBeLessThan(.02);
});
it("bounds prediction to 30 ms, holds on loss, and respects joint limits",()=> {
  const f=new ArmJointFilter(); f.sample(model,{j:0},"a",0,1/30,0,{j:1});
  f.sample(model,{j:.03},"a",.03,1/30,1,{j:1});
  expect(f.sample(model,{j:.03},"a",.07,1/30,1,{j:1}).j).toBeLessThanOrEqual(.06);
  const held=f.sample(model,{j:.03},"a",.071,1/30,1,{j:1}).j;
  f.hold(1); f.hold(2);
  expect(f.sample(model,{j:.03},"a",2,1/30,1,{j:1}).j).toBeCloseTo(held,8);
  expect(f.sample(model,{j:100},"a",2.1,1/30,2,{j:100}).j).toBeLessThanOrEqual(2);
});
it("keeps the mini panel 25% larger with proportional bounds",()=> {
  expect(ARM_PANEL_STYLE.defaultScale).toBe(.7*1.25);
  expect(clampArmPanelScale(0)).toBe(.65625);
  expect(clampArmPanelScale(100)).toBe(1.75);
});
it("context ignores origin object identity",()=> {
 const a={position:[0,0,0],orientation:[0,0,0,1]} as any;
 expect(armMotionContext("a","arm",a)).toBe(armMotionContext("a","arm",{...a}));
});

it("preserves a restored localization but retires a new localization observation",()=> {
  const a={position:[1,2,3],orientation:[0,0,0,1],ts:4,confidence:1} as any;
  expect(sameArmTrackingOrigin(a,{...a,position:[1,2,3]})).toBe(true);
  expect(sameArmTrackingOrigin(a,{...a,ts:5})).toBe(false);
  expect(sameArmTrackingOrigin(a,{...a,position:[1,2,3.01]})).toBe(false);
  expect(sameArmTrackingOrigin(a,null)).toBe(false);
});

it("does not infer ongoing motion or overshoot from a sparse IK pose change",()=> {
  const f=new ArmJointFilter(); f.sample(model,{j:0},"a",0);
  let previous=0;
  for(let frame=0;frame<=30;frame++) {
    const q=f.sample(model,{j:1},"a",.25+frame/120);
    expect(q.j).toBeGreaterThanOrEqual(previous-1e-8);
    expect(q.j).toBeLessThanOrEqual(1);
    previous=q.j;
  }
  expect(previous).toBeCloseTo(1);
});

it("keeps accepting preview updates throughout sixty seconds of dragging", () => {
  const filter = new ArmJointFilter();
  let target = { j: 0 }, sequence = 0, previous = 0, moved = 0;
  for (let frame = 0; frame < 60 * 90; frame++) {
    const now = frame / 90;
    if (frame % 6 === 0) { target = { j: Math.sin(now) }; sequence++; }
    const value = filter.sample(model, target, "drag", now, 1 / 15, sequence).j;
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value - target.j)).toBeLessThan(.12);
    if (Math.abs(value - previous) > 1e-6) moved++;
    previous = value;
  }
  expect(moved).toBeGreaterThan(4000);
});

it("does not predict advisory IK beyond its accepted endpoint", () => {
  const filter = new ArmJointFilter();
  filter.sample(model, {j: 0}, "preview", 0, 1 / 30, 0);
  filter.sample(model, {j: .6}, "preview", .04, 1 / 30, 1);
  let previous = 0;
  for (let frame = 1; frame <= 20; frame++) {
    const value = filter.sample(model, {j: .6}, "preview", .04 + frame / 90, 1 / 30, 1).j;
    expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
    expect(value).toBeLessThanOrEqual(.6);
    previous = value;
  }
  expect(previous).toBeCloseTo(.6);
});

it("spans sparse preview updates without extending the measured-feedback horizon", () => {
  const preview = new ArmJointFilter(0.15, 0.25);
  const measured = new ArmJointFilter();
  for (const filter of [preview, measured]) {
    filter.sample(model, { j: 0 }, "arm", 0);
    filter.sample(model, { j: 1 }, "arm", 0.2);
  }
  expect(preview.sample(model, { j: 1 }, "arm", 0.36).j).toBeGreaterThan(0.8);
  expect(preview.sample(model, { j: 1 }, "arm", 0.36).j).toBeLessThan(1);
  expect(measured.sample(model, { j: 1 }, "arm", 0.36).j).toBe(1);
  expect(preview.sample(model, { j: 1 }, "arm", 0.4).j).toBeCloseTo(1);
});
