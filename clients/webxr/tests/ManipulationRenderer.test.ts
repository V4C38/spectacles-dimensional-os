import { URL as FileURL } from "node:url";
import { readFileSync } from "node:fs";
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
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
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
    gripper_joints: {},
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
it("keeps the gripper menu across hover transitions and shows the target guide", () => {
  const r = new ManipulationRenderer();
  const apply = (now: number) =>
    applyRenderer(r, { target: { ...pose, position: [0.2, 0, 0.3] }, now });
  r.eeHovered = true;
  apply(1);
  expect(r.gripperMenu.visible).toBe(true);
  expect(r.gripperMenu.position.y).toBeCloseTo(
    r.handle.object.position.y - 0.05,
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
  const r = new ManipulationRenderer();
  const apply = (now: number, plan: any = null) =>
    applyRenderer(r, { target: { ...pose, position: [0.1, 0, 0.2] }, plan, now });
  apply(1);
  const plan = {
    plan_id: "one",
    joint_names: [],
    trajectory: [
      { time: 0, positions: [] },
      { time: 1, positions: [] },
    ],
    duration: 1,
  };
  r.previewRequested = true;
  apply(50, plan);
  expect(r.previewRequested).toBe(true);
  expect(r.measuredHandle.object.visible).toBe(true);
  expect(r.handle.object.visible).toBe(true);
  expect(r.measuredHandle.collider.userData.interactionEnabled).toBe(false);
  apply(50.5, plan);
  expect(r.previewRequested).toBe(true);
  apply(51.1, plan);
  expect(r.previewRequested).toBe(false);
  r.dispose();
});

it("keeps robot status on one line and includes the arm speed", () => {
  const r = new ManipulationRenderer();
  speedScale = 0.35;
  applyRenderer(r, { selected: false, now: 1, status: "Returning to\nzero pose with a long status", robotTitle: "OpenYAM" });
  const label = r.baseMarker.children.find(
    (c) => c.constructor.name === "RobotMarkerLabel",
  ) as any;
  expect(label.tagStatus.text).not.toContain("\n");
  expect(label.tagStatus.text).not.toContain("35%");
  expect(label.tagMessage.text).toBe("Movement speed 35%");
  expect(label.tagMessage.fillOpacity).toBe(0.5);
  expect(label.tagMessage.fontSize).toBeLessThan(label.tagStatus.fontSize);
  expect(label.tagMessage.position.y).toBeLessThan(label.tagStatus.position.y);
  expect(label.tagStatus.maxWidth).toBe(Infinity);
  r.dispose();
});

const readyIntent = { targetOffset: true, hasDraft: true, dragging: false, planning: false,
  executing: false, resetting: false, stopped: false, fresh: true, canPreview: true, canExecute: true, canReset: true };

it("shows measured and dragged spheres and a full-opacity connector in unselected following", () => {
  const r = new ManipulationRenderer();
  const s = { ...state, following: true };
  const target = {
    ...pose,
    position: [0.2, 0, 0.3] as [number, number, number],
  };
  applyRenderer(r, { state: s, selected: false, target, now: 1, snapshot: {
      ...readyIntent,
      dragging: true,
    } });
  expect(r.measuredHandle.object.visible).toBe(true);
  expect(
    r.handle.object.position.distanceTo(r.measuredHandle.object.position),
  ).toBeGreaterThan(0.1);
  expect(r.measuredHandle.collider.scale.x).toBeLessThan(
    r.handle.collider.scale.x,
  );
  expect(
    (r.measuredHandle.visual.material as THREE.ShaderMaterial).uniforms
      .uOpacity.value,
  ).toBe(0.3);
  expect((r.measuredHandle.visual.material as THREE.Material).transparent).toBe(true);
  expect(r.path.visible).toBe(true);
  expect(r.path.material.uniforms.uOpacity.value).toBe(1);
  r.dispose();
});

it("uses path provenance for opacity even when the actual planned path is straight", () => {
  const r = new ManipulationRenderer();
  const target = { ...pose, position: [0.2, 0, 0] as [number, number, number] };
  applyRenderer(r, { target, now: 1 });
  expect(r.path.material.uniforms.uOpacity.value).toBe(0.5);
  applyRenderer(r, { target, plan: {
      plan_id: "straight",
      joint_names: [],
      trajectory: [{ time: 0, positions: [] }],
      duration: 0,
    }, now: 1.1 });
  expect(r.path.material.uniforms.uOpacity.value).toBe(0.7);
  r.dispose();
});

it("keeps Preview above an offset target and hides both marker buttons immediately during a grab", () => {
  const r = new ManipulationRenderer();
  const target = { ...pose, position: [0.2, 0, 0] as [number, number, number] };
  const apply = (now: number, dragging = false, targetOffset = true) =>
    applyRenderer(r, { target, now, snapshot: { ...readyIntent, dragging, targetOffset } });
  r.eeHovered = true;
  apply(1);
  expect(r.gripperMenu.visible).toBe(true);
  expect(r.previewMenu.visible).toBe(true);
  expect(r.previewMenu.position.y).toBeGreaterThan(r.handle.object.position.y);
  expect(r.gripperMenu.position.y).toBeLessThan(r.handle.object.position.y);
  apply(1.1, true);
  expect(r.gripperMenu.visible).toBe(false);
  expect(r.previewMenu.visible).toBe(false);
  r.eeHovered = false;
  apply(1.2);
  expect(r.gripperMenu.visible).toBe(false);
  expect(r.previewMenu.visible).toBe(false);
  apply(1.3, false, false);
  expect(r.previewMenu.visible).toBe(false);
  r.dispose();
});

it("uses one contextual emergency control below a narrower Stop and includes the speed slider", () => {
  const r = new ManipulationRenderer();
  applyRenderer(r, { now: 1 });
  const stop = r.panel.children.find(
    (c) => c.userData.manipulationAction === "stop",
  ) as any;
  const emergency = r.panel.children.find(
    (c) => c.userData.manipulationAction === "estop",
  ) as any;
  expect(stop.position.y).toBeGreaterThan(emergency.position.y);
  expect(stop.rangeX).toBeLessThan(emergency.rangeX);
  expect(r.owns(r.speedSlider.hit)).toBe(true);
  expect(r.speedSlider.position.y).toBeLessThan(stop.position.y);
  applyRenderer(r, { state: { ...state, stopped: true, stop_confirmed: true }, now: 1.1 });
  expect(emergency.userData.manipulationAction).toBe("resume");
  expect(emergency.text).toBe("Resume operation");
  expect(
    r.panel.children.filter((c) =>
      ["estop", "resume"].includes(c.userData.manipulationAction),
    ),
  ).toHaveLength(1);
  expect(emergency.enabled).toBe(true);
  applyRenderer(r, { state: { ...state, stopped: true, stop_confirmed: false }, now: 1.2 });
  expect(emergency.enabled).toBe(false);
  r.dispose();
});


it("trims the executing path from raw measured joints without selection boxes", () => {
  const r = new ManipulationRenderer();
  const s = structuredClone(state);
  s.model!.joints[0].kind = "prismatic";
  s.model!.joints[0].axis = [1, 0, 0];
  s.model!.links[1].bounds = { center: [0, 0, 0], size: [0.03, 0.03, 0.03] };
  s.groups![0].joint_names = ["fixed"];
  s.observations!.arm.joints = { fixed: 0 };
  s.execution = "executing";
  s.operation_id = "op";
  s.plan = {
    plan_id: "motion",
    joint_names: ["fixed"],
    duration: 2,
    trajectory: [
      { time: 0, positions: [0] },
      { time: 2, positions: [1] },
    ],
  };
  const target = { ...pose, position: [1, 0, 0] as [number, number, number] };
  const apply = (now: number, fresh = true) =>
    applyRenderer(r, { state: s, target, now, fresh });
  const startDistance = () => (r.path.material as THREE.ShaderMaterial).uniforms.uStartDistance.value;
  apply(1);
  const geometry = r.path.geometry;
  s.observations!.arm.joints.fixed = 0.5;
  s.observations!.arm.pose = { ...pose, position: [0.5, 0, 0] };
  apply(1.05);
  expect(startDistance()).toBeCloseTo(0.5);
  expect(r.path.geometry).toBe(geometry);
  expect(r.object.getObjectByName("LinkBounds_tool")).toBeUndefined();
  apply(1.1);
  expect(startDistance()).toBeCloseTo(0.5);
  s.observations!.arm.joints.fixed = 0.75;
  apply(1.15);
  expect(startDistance()).toBeCloseTo(0.75);
  s.observations!.arm.joints.fixed = 0.7;
  apply(1.2);
  expect(startDistance()).toBeCloseTo(0.75);
  apply(1.3, false);
  expect(startDistance()).toBeCloseTo(0.75);
  s.observations!.arm.joints.fixed = 0.9;
  apply(1.4);
  expect(r.object.getObjectByName("LinkBounds_tool")).toBeUndefined();
  r.dispose();
});

it("shows movement-weighted 3D links without arm boxes", () => {
  const fixture = JSON.parse(
    readFileSync(
      new FileURL("./integration-tests/fixtures/OpenYAM.json", import.meta.url),
      "utf8",
    ),
  );
  const load = vi
    .spyOn(GLTFLoader.prototype, "load")
    .mockImplementation((_url, loaded) => {
      const scene = new THREE.Group();
      scene.userData.visual_signature = fixture.model.visual_signature;
      for (const link of fixture.model.links) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial());
        mesh.name = link.name; scene.add(mesh);
      }
      loaded({ scene } as never);
    });
  const r = new ManipulationRenderer();
  try {
    const arm: ManipulationState = {
      ...state,
      model: fixture.model,
      groups: [
        {
          id: "arm",
          joint_names: Object.keys(fixture.joints),
          base_frame: "base",
          tip_frame: "gripper_tip",
          has_gripper: true,
          following: true,
        },
      ],
      observations: {
        arm: {
          joints: fixture.joints,
          measured_at: 1,
          pose: fixture.pose,
          gripper: 0,
        },
      },
    };
    const solution = {
      ...fixture.joints,
      yam_joint6: fixture.joints.yam_joint6 + 0.8,
    };
    const target = {
      ...pose,
      position: [0.2, 0, 0.3] as [number, number, number],
    };
    const intent = {
      dragging: true,
      targetOffset: true,
      executing: false,
    } as any;
    applyRenderer(r, { state: arm, selected: false, target, solution, now: 1, robotTitle: "OpenYAM", snapshot: intent });
    const models = (r as any).modelRenderer;
    const moving = models.previewMeshes.get("gripper") as THREE.Mesh;
    const stationary = models.previewMeshes.get("link2") as THREE.Mesh;
    expect(moving.visible).toBe(true);
    expect((moving.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeGreaterThan(0);
    expect(Array.from(stationary.geometry.getAttribute("armAlpha").array).every(value => value === 0)).toBe(true);
    expect(r.object.getObjectByName("LinkBounds_link3")).toBeUndefined();
    rejection = { revision: 1, pose: target, message: "IK failed" };
    applyRenderer(r, { state: arm, selected: false, target, solution, now: 1.1, status: "IK failed", robotTitle: "OpenYAM", snapshot: intent });
    expect(
      (moving.children.find(c => c.userData.armOutline) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.uColor.value.getHex(),
    ).toBe(0xffcc00);
    applyRenderer(r, { state: arm, selected: false, target, solution, now: 3, status: "IK failed", robotTitle: "OpenYAM", snapshot: intent });
    expect(r.warning.object.visible).toBe(true);
  } finally {
    r.dispose();
    load.mockRestore();
  }
});

import {
  deriveManipulationSnapshot,
  targetIsOffset,
  type ManipulationSnapshot,
} from "@dimos-ar-client/manipulation/ManipulationInteraction";
import type { ManipulationPresentation } from "../src/manipulation/ManipulationRenderer";
let speedScale = 0.2;
let rejection: ManipulationPresentation["rejection"] = null;
type RendererFixture = Partial<Pick<ManipulationPresentation,
  "origin" | "groupId" | "selected" | "target" | "solution" | "plan" | "now" | "robotTitle"
>> & { state?: ManipulationState; status?: string; fresh?: boolean; snapshot?: Partial<ManipulationSnapshot> };
function applyRenderer(renderer: ManipulationRenderer, input: RendererFixture = {}): void {
  const { state: current = state, origin: trackingOrigin = origin, groupId = "arm",
    selected = true, target = null, solution = null, plan = null, now = 0,
    status = "", fresh = true, robotTitle = "Arm", snapshot = {} } = input;
  const intent = deriveManipulationSnapshot({
    available: current.available,
    fresh,
    selected,
    targetOffset: targetIsOffset(
      target,
      current.observations?.[groupId ?? ""]?.pose,
    ),
    gripperDraft: false,
    dragging: false,
    planning: false,
    executing: ["accepted", "executing"].includes(current.execution ?? ""),
    resetting: !!current.operation,
    stopped: current.stopped === true,
    stopConfirmed: current.stop_confirmed === true,
    pendingControl: false,
    following: current.following === true,
    rejection: rejection !== null,
    status,
    runtimeMessage: current.message,
  });
  renderer.apply({
    state: current,
    origin: trackingOrigin,
    groupId,
    selected,
    target,
    solution,
    plan,
    now,
    robotTitle,
    intent: { ...intent, ...snapshot },
    speedScale,
    rejection,
    desiredGripper: null,
  });
}

beforeEach(() => {
  speedScale = 0.2;
  rejection = null;
});

it("retires late model loads after replacement and disposal", () => {
  const callbacks: Array<(gltf: any) => void> = [];
  const loader = vi
    .spyOn(GLTFLoader.prototype, "load")
    .mockImplementation((_url, loaded) => {
      callbacks.push(loaded);
    });
  const renderer = new ManipulationRenderer();
  const first = structuredClone(state);
  first.model!.asset_url = "/first.glb";
  const second = structuredClone(first);
  second.model!.revision = "second";
  second.model!.asset_url = "/second.glb";
  const late = () => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    mesh.name = "base";
    scene.add(mesh);
    return {
      scene,
      geometry: vi.spyOn(mesh.geometry, "dispose"),
      material: vi.spyOn(mesh.material, "dispose"),
    };
  };
  try {
    applyRenderer(renderer, { state: first, now: 1 });
    applyRenderer(renderer, { state: second, now: 2 });
    const replaced = late();
    callbacks[0]({ scene: replaced.scene });
    expect(replaced.geometry).toHaveBeenCalledTimes(1);
    expect(replaced.material).toHaveBeenCalledTimes(1);
    renderer.dispose();
    const disposed = late();
    callbacks[1]({ scene: disposed.scene });
    expect(disposed.geometry).toHaveBeenCalledTimes(1);
    expect(disposed.material).toHaveBeenCalledTimes(1);
  } finally {
    loader.mockRestore();
  }
});

it("retries transient model failures with backoff and immediately after rendering recovers", () => {
  const callbacks: Array<(gltf: any) => void> = [];
  const errors: Array<() => void> = [];
  const loader = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, loaded, _progress, failed) => {
    callbacks.push(loaded); errors.push(() => failed!(new Error("offline")));
  });
  const renderer = new ManipulationRenderer();
  const modelState = structuredClone(state); modelState.model!.asset_url = "/retry.glb";
  const apply = (now: number, active = true) => applyRenderer(renderer, { state: modelState, origin: active ? origin : null, now });
  try {
    apply(1); errors[0]();
    apply(1.49); expect(loader).toHaveBeenCalledTimes(1);
    apply(1.5); expect(loader).toHaveBeenCalledTimes(2); errors[1]();
    apply(2.49); expect(loader).toHaveBeenCalledTimes(2);
    apply(2.5); expect(loader).toHaveBeenCalledTimes(3); errors[2]();
    apply(2.6, false); apply(2.7);
    expect(loader).toHaveBeenCalledTimes(4);
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = "tool"; scene.add(mesh); callbacks[3]({ scene });
    apply(2.8);
    expect((renderer as any).modelRenderer.previewMeshes.get("tool")?.visible).toBe(true);
    expect((renderer as any).modelRenderer.assetMessage).toBe("");
    apply(20); expect(loader).toHaveBeenCalledTimes(4);
    renderer.dispose();
    (renderer as any).modelRenderer.tick(30, true); expect(loader).toHaveBeenCalledTimes(4);
  } finally { renderer.dispose(); loader.mockRestore(); }
});

it("keeps the selected mesh moving between sparse live IK updates throughout a held grab", () => {
  const loader = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, loaded) => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial());
    mesh.name = "tool"; scene.add(mesh); loaded({ scene } as never);
  });
  const renderer = new ManipulationRenderer();
  const moving = structuredClone(state);
  moving.model!.asset_url = "/moving.glb";
  moving.model!.joints[0] = { ...moving.model!.joints[0], name: "j", kind: "revolute" };
  moving.groups![0].joint_names = ["j"];
  moving.observations!.arm.joints = { j: 0 };
  let solution = { j: 0 }, previous = new THREE.Quaternion(), moved = 0, largestStep = 0;
  try {
    for (let frame = 0; frame < 270; frame++) {
      if (frame % 18 === 0) solution = { j: frame / 18 * 0.04 };
      applyRenderer(renderer, { state: moving, target: { ...pose, position: [0.2, 0, 0.3] }, solution, now: 1 + frame / 90, snapshot: { dragging: true } });
      const mesh = (renderer as any).modelRenderer.previewMeshes.get("tool") as THREE.Object3D;
      if (frame > 45) {
        expect(mesh.visible).toBe(true);
        const step = previous.angleTo(mesh.quaternion);
        if (step > 0.00001) moved++;
        largestStep = Math.max(largestStep, step);
      }
      previous.copy(mesh.quaternion);
    }
    expect(moved).toBeGreaterThan(210);
    expect(largestStep).toBeLessThan(0.005);
    expect(previous.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.4);
  } finally { renderer.dispose(); loader.mockRestore(); }
});

it("disposes shared model geometry once across measured, preview and tool clones", () => {
  const loader = vi
    .spyOn(GLTFLoader.prototype, "load")
    .mockImplementation((_url, loaded) => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshBasicMaterial(),
      );
      mesh.name = "tool";
      scene.add(mesh);
      loaded({ scene } as never);
    });
  const renderer = new ManipulationRenderer();
  try {
    const modelState = structuredClone(state);
    modelState.model!.asset_url = "/shared.glb";
    const target = {
      ...pose,
      position: [0.2, 0, 0] as [number, number, number],
    };
    applyRenderer(renderer, { state: modelState, target, now: 1 });
    const models = (renderer as any).modelRenderer;
    const mesh = models.ghosts.get("tool") as THREE.Mesh;
    expect(models.previewMeshes.get("tool").geometry).toBe(mesh.geometry);
    expect(models.previewMeshes.get("tool").children.some((c: THREE.Object3D) => c.userData.armOutline)).toBe(true);
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    renderer.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
  } finally {
    loader.mockRestore();
  }
});


it("shows only the outline on hover and fades the selected fill while preserving mesh picking", () => {
  const load = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, loaded) => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial());
    mesh.name = "base"; scene.add(mesh); loaded({ scene } as never);
  });
  const r = new ManipulationRenderer();
  const s = structuredClone(state); s.model!.asset_url = "/arm.glb";
  let now = 1;
  const apply = (selected: boolean) => { applyRenderer(r, { state: s, selected, now: now += 1 / 60 }); r.object.updateMatrixWorld(true); };
  try {
    apply(false);
    const model = (r as any).modelRenderer;
    const pick = model.ghosts.get("base") as THREE.Mesh;
    const visual = model.previewMeshes.get("base") as THREE.Mesh;
    expect(visual.visible).toBe(false);
    expect(pick.userData.meshSelection).toBe(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(pick, true).length).toBeGreaterThan(0);
    // This point lies inside the old link bounds but outside the actual mesh.
    ray.ray.origin.x = 0.05; expect(ray.intersectObject(pick, true)).toHaveLength(0);
    r.hoveredLink = "base"; apply(false);
    expect(visual.visible).toBe(true);
    expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBe(0);
    expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeLessThan(1);
    for (let i = 0; i < 80; i++) apply(false);
    expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBe(0);
    r.hoveredLink = null; apply(true);
    for (let i = 0; i < 80; i++) apply(true);
    expect(visual.visible).toBe(true); expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBe(1.1);
    apply(false); expect(visual.visible).toBe(true);
    for (let i = 0; i < 80; i++) apply(false);
    expect(visual.visible).toBe(false);
    expect(ray.intersectObject(pick, true)).toHaveLength(0);
    expect(r.object.getObjectByName("LinkBounds_base")).toBeUndefined();
  } finally { r.dispose(); load.mockRestore(); }
});


it("keeps the measured sphere visible even when selected target equals feedback", () => {
  const r = new ManipulationRenderer();
  try {
    applyRenderer(r, { target: pose, now: 1 });
    expect(r.measuredHandle.object.visible).toBe(true);
    expect(r.measuredHandle.collider.userData.interactionEnabled).toBe(false);
    expect(r.measuredHandle.visual.renderOrder).toBeGreaterThan(r.handle.visual.renderOrder);
  } finally { r.dispose(); }
});

it("keeps gripper below the EE in selected mode with matching Preview and Execute above", () => {
  const r = new ManipulationRenderer();
  try {
    r.eeHovered = true;
    const target = { ...pose, position: [0.1, 0, 0] as [number, number, number] };
    applyRenderer(r, { target, now: 1 });
    const button = r.controlsView.buttons.get("gripper")!;
    expect(button.text).toBe("Open");
    expect(button.userData.manipulationAction).toBe("gripper");
    const preview = r.controlsView.buttons.get("plan")!;
    const execute = r.controlsView.buttons.get("execute")!;
    expect(preview.parent).toBe(execute.parent);
    expect(preview.position.y).toBeGreaterThan(execute.position.y);
    expect(preview.position.z).toBe(execute.position.z);
    expect(preview.scale.toArray()).toEqual(execute.scale.toArray());
    expect(r.previewMenu.position.y).toBeGreaterThan(r.gripperMenu.position.y);
    expect(r.gripperMenu.visible).toBe(true);
    applyRenderer(r, { selected: false, target, now: 1.1 });
    expect(button.text).toBe("Open"); expect(button.userData.manipulationAction).toBe("gripper");
  } finally { r.dispose(); }
});


it("uses full opacity for an executing path and planning opacity for its draft", () => {
  const r = new ManipulationRenderer();
  const target = { ...pose, position: [0.1, 0, 0] as [number, number, number] };
  try {
    applyRenderer(r, { target, now: 1 });
    expect(r.path.material.uniforms.uOpacity.value).toBe(0.5);
    const moving = { ...state, execution: "executing" };
    applyRenderer(r, { state: moving, target, now: 1.1 });
    expect(r.path.material.uniforms.uOpacity.value).toBe(1);
  } finally { r.dispose(); }
});

it("keeps the EE grab radius three times the visual radius", () => {
  const renderer = new ManipulationRenderer();
  try {
    const radius = (mesh: THREE.Mesh) => (mesh.geometry as THREE.SphereGeometry).parameters.radius * mesh.scale.x;
    expect(radius(renderer.handle.visual)).toBeCloseTo(radius(renderer.handle.collider) / 3);
    expect(radius(renderer.measuredHandle.visual)).toBeCloseTo(radius(renderer.handle.visual) * 0.5);
    expect(renderer.measuredHandle.collider.userData.interactionEnabled).toBe(false);
  } finally { renderer.dispose(); }
});

it("moves and scales the arm controls independently and Pin restores the anchor", () => {
  const r = new ManipulationRenderer();
  try {
    applyRenderer(r, { now: 1 });
    const frame = r.controlsView.frame.object;
    const handles = frame.children.filter(child => child.userData.panelHandle);
    expect(handles.map(child => child.userData.panelHandle)).toEqual(["bar", "left", "right"]);
    expect(handles.every(child => child.userData.manipulationPanel)).toBe(true);
    const rootPose = r.baseMarker.position.clone();
    r.object.updateMatrixWorld(true);
    const label = r.controlsView.baseLabel;
    const labelPosition = label.getWorldPosition(new THREE.Vector3());
    const labelScale = label.getWorldScale(new THREE.Vector3());
    const labelRotation = label.getWorldQuaternion(new THREE.Quaternion());
    expect(label.parent).toBe(r.baseMarker);
    const pin = r.controlsView.buttons.get("pin")!;
    const icon = r.controlsView.frame.pinLines;
    expect(icon.parent).toBe(r.panel);
    icon.geometry.computeBoundingBox();
    expect(icon.geometry.boundingBox!.getSize(new THREE.Vector3()).y).toBeGreaterThan(.012);
    expect(pin.position.y).toBeGreaterThan(r.controlsView.buttons.get("reset")!.position.y + .032);

    r.detachPanel();
    r.panel.position.set(1, 2, 3); r.panel.rotation.set(.1, .2, .3); r.panel.scale.setScalar(1.2);
    applyRenderer(r, { now: 2 });
    expect(r.panel.position.toArray()).toEqual([1, 2, 3]);
    r.object.updateMatrixWorld(true);
    expect(label.getWorldPosition(new THREE.Vector3()).toArray()).toEqual(labelPosition.toArray());
    expect(label.getWorldScale(new THREE.Vector3()).toArray()).toEqual(labelScale.toArray());
    expect(label.getWorldQuaternion(new THREE.Quaternion()).toArray()).toEqual(labelRotation.toArray());
    expect(r.baseMarker.position.toArray()).toEqual(rootPose.toArray());
    r.resetPanel();
    expect(r.panel.parent).toBe(r.baseMarker);
    expect(r.panel.position.toArray()).toEqual([0, -.13, 0]);
    expect(r.panel.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(r.panel.scale.toArray()).toEqual([.875, .875, .875]);
    expect(r.controlsView.buttons.get("pin")!.userData.manipulationAction).toBe("pin");
  } finally { r.dispose(); }
});

for (const selected of [false, true]) it(`keeps rendered model and picking continuous across ${selected ? "planned" : "measured"} updates`, () => {
  const load = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, loaded) => {
    const scene = new THREE.Group();
    const tool = new THREE.Mesh(new THREE.BoxGeometry(.03, .03, .03), new THREE.MeshBasicMaterial());
    tool.name = "tool"; scene.add(tool); loaded({scene} as never);
  });
  const r = new ManipulationRenderer(), s = structuredClone(state);
  s.model!.asset_url = "/motion.glb";
  s.model!.joints[0].kind = "prismatic"; s.model!.joints[0].axis = [1,0,0];
  s.model!.links[1].bounds = {center: [0,0,0], size: [.03,.03,.03]};
  s.observations!.arm.joints = {fixed: 0};
  const apply = (time: number, mode: boolean, solution: Record<string,number> | null) =>
    applyRenderer(r, { state: s, selected: mode, solution, now: time });
  try {
    apply(1, selected, selected ? {fixed: 0} : null);
    const model = (r as any).modelRenderer;
    const visual = model.previewMeshes.get("tool"), pick = model.ghosts.get("tool");
    if (!selected) s.observations!.arm.joints!.fixed = .6;
    const solution = selected ? {fixed: .6} : null;
    apply(1.01, selected, solution);
    const first = -visual.position.z;
    expect(first).toBeCloseTo(0);
    apply(1.02, selected, solution);
    const second = -visual.position.z;
    expect(second).toBeGreaterThan(first); expect(second).toBeLessThan(.6);
    apply(1.02, !selected, solution);
    expect(-visual.position.z).toBeCloseTo(second, 8);
    expect(pick.position.toArray()).toEqual(visual.position.toArray());
    s.available = false; apply(1.02, !selected, solution);
    s.available = true; apply(1.03, !selected, solution);
    expect(-visual.position.z).toBeGreaterThan(second);
    expect(-visual.position.z).toBeLessThanOrEqual(.6 + 1e-12);
  } finally { r.dispose(); load.mockRestore(); }
});

it("retains both EE handles, arm transforms, and Preview through a short feedback gap",()=> {
  const r=new ManipulationRenderer();
  const target={...pose,position:[.2,0,.3] as [number,number,number]};
  try {
    applyRenderer(r, { target, solution: {}, now: 1 });
    const model=(r as any).modelRenderer;
    const snapshot=()=>[...model.previewMeshes.values()].map((o:any)=>[o.visible,...o.position.toArray(),...o.quaternion.toArray()]);
    const before=snapshot(), measured=r.measuredHandle.object.position.toArray();
    const moved={...target,position:[.3,0,.3] as [number,number,number]};
    for(const now of [1.1,1.5,2.9]) applyRenderer(r, { state: {...state,available:false}, target: moved, now, status: "No feedback", fresh: false, snapshot: {retainingFeedback:true} });
    expect(snapshot()).toEqual(before);
    expect(r.measuredHandle.object.position.toArray()).toEqual(measured);
    expect(r.measuredHandle.object.visible).toBe(true); expect(r.handle.object.visible).toBe(true);
    expect(r.controlsView.buttons.get("execute")!.enabled).toBe(false);
    expect(r.handle.object.position.toArray()).not.toEqual(measured);
    applyRenderer(r, { state: {...state,available:false}, now: 3.1, status: "No feedback", fresh: false });
    expect(r.handle.object.visible).toBe(false); expect(r.measuredHandle.object.visible).toBe(false);
  } finally {r.dispose();}
});


it("owns the visible handle's rejection, stale and blocked center colors", () => {
  const renderer = new ManipulationRenderer();
  const color = () => (renderer.handle.visual.material as THREE.ShaderMaterial).uniforms.uCenterColor.value.getHex();
  rejection = { revision: 1, pose, message: "IK failed" };
  applyRenderer(renderer, { selected: false, target: pose, now: 1 });
  expect(color()).toBe(0xffcc00);
  applyRenderer(renderer, { selected: false, target: pose, now: 2, snapshot: { blocked: true } });
  expect(color()).toBe(0x8e969e);
  rejection = null;
  applyRenderer(renderer, { selected: false, target: pose, now: 3, fresh: false });
  expect(color()).toBe(0xffcc00);
  applyRenderer(renderer, { selected: false, target: pose, now: 4 });
  expect(color()).toBe(0xb3b3b3);
  renderer.dispose();
});
