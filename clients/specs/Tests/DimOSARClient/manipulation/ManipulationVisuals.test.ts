import { expect, it } from "vitest";
import { ARM_VISUAL_STYLE, armPointWeight, armShapeEdges, armLinkWeight, gripperBounds, armLinkPresentation, ArmMeshFade } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationVisuals";
import { linkPoses } from "../../../Assets/Scripts/DimOSARClient/manipulation/ModelKinematics";
import { ARM_FIXTURE } from "../../integration-tests/IntegrationArmFixture";

it("keeps the perimeter of a triangulated plane without its diagonal or duplicate seams", () => {
  const points = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  const edges = armShapeEdges(points, [0, 1, 2, 3, 4, 5]);
  expect(edges).toHaveLength(8);
  for (let i = 0; i < edges.length; i += 2) expect(Math.hypot(...edges[i].map((v, axis) => v - edges[i + 1][axis]))).toBeCloseTo(1);
});
it("fades stationary links and counts rotation as displacement", () => {
  const pose = { position: [0, 0, 0], orientation: [0, 0, 0, 1] } as const;
  expect(armLinkWeight(pose as any, pose as any)).toBe(0);
  expect(armLinkWeight(pose as any, { position: [0, 0, 0], orientation: [0, 0, 1, 0] })).toBe(1);
  expect(ARM_VISUAL_STYLE.gapM).toBeGreaterThan(ARM_VISUAL_STYLE.dashM);
});
it("builds one finite gripper union in the tool root frame as fingers articulate", () => {
  const model = ARM_FIXTURE.model as any;
  const poses = linkPoses(model, ARM_FIXTURE.joints);
  const bounds = gripperBounds(model, poses, "gripper_tip");
  expect(bounds.root).toBe("gripper");
  expect(bounds.links.has("tip_left")).toBe(true);
  expect(bounds.links.has("link5")).toBe(false);
  expect(bounds.size.every(v => Number.isFinite(v) && v > 0)).toBe(true);
});

it("shares hover, selection, displacement and failure presentation across hosts", () => {
  const baseline = { selected: false, hovered: false, dragging: false, finishing: false,
    displaced: false, playing: false, weight: 0, failed: false, failedLink: false };
  expect(armLinkPresentation(baseline).visible).toBe(false);
  expect(armLinkPresentation({ ...baseline, hovered: true })).toMatchObject({ visible: true, alpha: 1.10, showFill: false });
  expect(armLinkPresentation({ ...baseline, selected: true })).toMatchObject({ visible: true, alpha: 1.1 });
  for (const state of [{ dragging: true }]) {
    expect(armLinkPresentation({ ...baseline, ...state, hovered: true }).visible).toBe(false);
    expect(armLinkPresentation({ ...baseline, ...state, hovered: true, displaced: true, weight: 0.4 }).alpha).toBeCloseTo(0.42);
  }
  expect(armLinkPresentation({ ...baseline, failed: true })).toMatchObject({ visible: true, color: ARM_VISUAL_STYLE.warningColor });
  expect(armLinkPresentation({ ...baseline, failed: true, failedLink: true }).color).toBe(ARM_VISUAL_STYLE.warningColor);
});

it("fades model visibility without changing selection or displacement policy", () => {
  const fade = new ArmMeshFade();
  fade.beginFrame(0, "arm"); expect(fade.sample("base", 0)).toBe(0);
  fade.beginFrame(0.016, "arm"); const start = fade.sample("base", 1);
  expect(start).toBeGreaterThan(0); expect(start).toBeLessThan(1);
  fade.beginFrame(0.032, "arm"); const next = fade.sample("base", 1); expect(next).toBeGreaterThan(start);
  fade.beginFrame(0.048, "arm"); const ending = fade.sample("base", 0);
  expect(ending).toBeGreaterThan(0); expect(ending).toBeLessThan(next);
  for (let frame = 4; frame < 80; frame++) { fade.beginFrame(frame / 60, "arm"); fade.sample("base", 0); }
  fade.beginFrame(2, "arm"); expect(fade.sample("base", 0)).toBe(0);
});


it("keeps the complete selected planner mesh at normal strength through hover and unhover", () => {
  for (const hovered of [false, true, false]) for (const weight of [0, 0.1, 1]) {
    for (const dragging of [false, true]) {
      expect(armLinkPresentation({ selected: true, hovered, dragging, finishing: false,
        displaced: weight > 0, playing: false, weight, failed: false, failedLink: false }))
        .toMatchObject({ visible: true, showFill: true, widthM: ARM_VISUAL_STYLE.widthM, alpha: hovered ? 1.15 * 1.1 : 1.1 });
    }
  }
});

it("fades a rotating link by local surface displacement", () => {
  const measured = { position: [0, 0, 0], orientation: [0, 0, 0, 1] } as any;
  const proposed = { position: [0, 0, 0], orientation: [0, 0, Math.sin(0.1), Math.cos(0.1)] } as any;
  expect(armPointWeight([0, 0, 0], measured, proposed)).toBe(0);
  expect(armPointWeight([0.2, 0, 0], measured, proposed)).toBeGreaterThan(0);
  expect(armPointWeight([0.6, 0, 0], measured, proposed)).toBe(1);
});


it("prepared point displacement agrees with rigid-pose evaluation", async () => {
  const {armPointDisplacement} = await import("../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationVisuals");
  for (const angle of [0, .1, .6, -1]) {
    const a = {position:[.01,.02,.03],orientation:[0,Math.sin(.05),0,Math.cos(.05)]} as any;
    const b = {position:[.04,.01,.02],orientation:[0,0,Math.sin(angle/2),Math.cos(angle/2)]} as any;
    const weight = armPointDisplacement(a,b);
    for (const point of [[0,0,0], [.2,.03,-.05], [-.01,.4,.5]] as [number,number,number][]) {
      expect(weight(...point)).toBeCloseTo(armPointWeight(point,a,b), 10);
    }
  }
});
