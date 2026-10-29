// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window, "AudioContext", {
    value: class {
      destination = {};
      createGain() {
        return { connect() {}, gain: { value: 1 } };
      }
    },
    configurable: true,
  });
});
import * as THREE from "three";
import { ManipulationRenderer } from "../src/manipulation/ManipulationRenderer";
import type { ManipulationState } from "@dimos-ar-client/manipulation/ManipulationTypes";
const pose = {
  position: [0, 0, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
};
const origin = { ...pose, confidence: 1, ts: 0 };
const state: ManipulationState = {
  type: "manipulation_state",
  available: true,
  root_pose: pose,
  model: {
    revision: "one",
    root: "base",
    asset_url: null,
    links: [
      { name: "base", bounds: { center: [0, 0, 0], size: [0.07, 0.2, 0.07] } },
      { name: "tool", bounds: null },
    ],
    joints: [
      {
        name: "fixed",
        kind: "fixed",
        parent: "base",
        child: "tool",
        axis: [0, 0, 1],
        origin: pose,
        mimic: null,
      },
    ],
  },
  groups: [
    {
      id: "arm",
      joint_names: [],
      base_frame: "base",
      tip_frame: "tool",
      has_gripper: true,
      following: true,
    },
  ],
  observations: { arm: { joints: {}, measured_at: 0, pose, gripper: 0 } },
  execution: "idle",
};
it("hides outlines without disabling colliders and keeps stop/reset available", () => {
  const r = new ManipulationRenderer();
  let time = 1;
  const apply = (selected: boolean) =>
    r.apply(
      state,
      origin,
      "arm",
      selected,
      null,
      null,
      null,
      (time += 0.1),
      "",
      true,
      "OpenYAM",
    );
  apply(false);
  const collider = r.object.getObjectByName("LinkBounds_base")!;
  expect(collider.parent!.children[0].visible).toBe(false);
  expect(collider.visible).toBe(true);
  r.hoveredLink = "base";
  apply(false);
  expect(collider.parent!.children[0].visible).toBe(true);
  r.hoveredLink = null;
  apply(true);
  expect(collider.parent!.children[0].visible).toBe(true);
  expect(
    r.panel.children.filter((c) =>
      c.visible && ["estop", "reset"].includes(c.userData.manipulationAction),
    ),
  ).toHaveLength(2);
  apply(false);
  expect(r.panel.visible).toBe(true);
  expect(r.baseMarker.visible).toBe(true);
  r.dispose();
});
it("keeps the gripper menu across hover transitions and shows the target guide", () => {
  const r = new ManipulationRenderer();
  const apply = (now: number) =>
    r.apply(
      state,
      origin,
      "arm",
      true,
      { ...pose, position: [0.2, 0, 0.3] },
      null,
      null,
      now,
      "",
      true,
    );
  r.eeHovered = true;
  apply(1);
  expect(r.gripperMenu.visible).toBe(true);
  expect(r.gripperMenu.position.y).toBeGreaterThan(
    r.handle.object.position.y + 0.05,
  );
  r.eeHovered = false;
  apply(1.1);
  expect(r.gripperMenu.visible).toBe(true);
  expect(r.path.visible).toBe(true);
  r.pinned = true;
  r.panel.position.set(1, 1, 1);
  r.faceViewer(new THREE.Vector3(0, 1.6, 1));
  expect(r.panel.position.toArray()).toEqual([1, 1, 1]);
  r.dispose();
});

it("plays Preview once from zero while retaining separate measured and target handles", () => {
  const r=new ManipulationRenderer();
  const apply=(now:number, plan:any=null)=>r.apply(state,origin,"arm",true,{...pose,position:[.1,0,.2]},null,plan,now,"",true);
  apply(1);
  const plan={plan_id:"one",joint_names:[],trajectory:[{time:0,positions:[]},{time:1,positions:[]}],duration:1};
  r.previewRequested=true;apply(50,plan);expect(r.previewRequested).toBe(true);
  expect(r.measuredHandle.object.visible).toBe(true);expect(r.handle.object.visible).toBe(true);
  expect(r.measuredHandle.collider.userData.interactionEnabled).toBe(false);
  apply(50.5,plan);expect(r.previewRequested).toBe(true);
  apply(51.1,plan);expect(r.previewRequested).toBe(false);r.dispose();
});

it("keeps robot status on one line and includes the arm speed", () => {
  const r = new ManipulationRenderer();
  r.speedScale = 0.35;
  r.apply(state, origin, "arm", false, null, null, null, 1,
    "Returning to\nzero pose with a long status", true, "OpenYAM");
  const label = r.baseMarker.children.find(c => c.constructor.name === "RobotMarkerLabel") as any;
  expect(label.tagStatus.text).not.toContain("\n");
  expect(label.tagStatus.text).toContain("35%");
  expect(label.tagStatus.maxWidth).toBe(Infinity);
  r.dispose();
});

it("combines both moving fingers into one gripper bound", () => {
  const r = new ManipulationRenderer();
  const s = structuredClone(state);
  s.model!.links.push(
    {name: "left", bounds: {center: [0, 0, 0], size: [0.02, 0.02, 0.05]}},
    {name: "right", bounds: {center: [0, 0, 0], size: [0.02, 0.02, 0.05]}},
  );
  s.model!.links.find(l => l.name === "tool")!.bounds = {
    center: [0, 0, 0], size: [0.04, 0.04, 0.04],
  };
  // An articulated tool is the common ancestor of the two finger links.
  s.model!.joints[0].kind = "revolute";
  s.model!.joints[0].axis = [0, 0, 1];
  s.model!.joints.push(...["left", "right"].map((name, i) => ({
    name, kind: "prismatic" as const, parent: "tool", child: name,
    axis: [0, i ? -1 : 1, 0] as [number,number,number], origin: pose,
    limits: {lower: 0, upper: 0.03}, mimic: null,
  })));
  r.apply(s, origin, "arm", true, null, null, null, 1, "", true);
  expect(r.object.getObjectByName("LinkBounds_left")!.parent!.visible).toBe(false);
  expect(r.object.getObjectByName("LinkBounds_right")!.parent!.visible).toBe(false);
  expect(r.object.getObjectByName("LinkBounds_tool")!.parent!.visible).toBe(true);
  r.dispose();
});
