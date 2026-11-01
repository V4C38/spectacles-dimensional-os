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
    applyRenderer(
      r,
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
  expect(r.gripperMenu.position.y).toBeLessThan(
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
    applyRenderer(
      r,
      state,
      origin,
      "arm",
      true,
      { ...pose, position: [0.1, 0, 0.2] },
      null,
      plan,
      now,
      "",
      true,
    );
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
  applyRenderer(
    r,
    state,
    origin,
    "arm",
    false,
    null,
    null,
    null,
    1,
    "Returning to\nzero pose with a long status",
    true,
    "OpenYAM",
  );
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
  applyRenderer(
    r,
    s,
    origin,
    "arm",
    false,
    target,
    null,
    null,
    1,
    "",
    true,
    "Arm",
    {
      ...readyIntent,
      dragging: true,
    },
  );
  expect(r.measuredHandle.object.visible).toBe(true);
  expect(
    r.handle.object.position.distanceTo(r.measuredHandle.object.position),
  ).toBeGreaterThan(0.1);
  expect(r.measuredHandle.collider.scale.x).toBeLessThan(
    r.handle.collider.scale.x,
  );
  expect(
    (r.measuredHandle.collider.material as THREE.ShaderMaterial).uniforms
      .uOpacity.value,
  ).toBe(0.18);
  expect((r.measuredHandle.collider.material as THREE.Material).transparent).toBe(true);
  expect(r.path.visible).toBe(true);
  expect(r.path.material.uniforms.uOpacity.value).toBe(1);
  r.dispose();
});

it("uses path provenance for opacity even when the actual planned path is straight", () => {
  const r = new ManipulationRenderer();
  const target = { ...pose, position: [0.2, 0, 0] as [number, number, number] };
  applyRenderer(r, state, origin, "arm", true, target, null, null, 1, "");
  expect(r.path.material.uniforms.uOpacity.value).toBe(0.5);
  applyRenderer(
    r,
    state,
    origin,
    "arm",
    true,
    target,
    null,
    {
      plan_id: "straight",
      joint_names: [],
      trajectory: [{ time: 0, positions: [] }],
      duration: 0,
    },
    1.1,
    "",
  );
  expect(r.path.material.uniforms.uOpacity.value).toBe(0.7);
  r.dispose();
});

it("keeps Preview above an offset target and hides both marker buttons immediately during a grab", () => {
  const r = new ManipulationRenderer();
  const target = { ...pose, position: [0.2, 0, 0] as [number, number, number] };
  const apply = (now: number, dragging = false, targetOffset = true) =>
    applyRenderer(
      r,
      state,
      origin,
      "arm",
      true,
      target,
      null,
      null,
      now,
      "",
      true,
      "Arm",
      { ...readyIntent, dragging, targetOffset },
    );
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
  expect(r.previewMenu.visible).toBe(true);
  apply(1.3, false, false);
  expect(r.previewMenu.visible).toBe(false);
  r.dispose();
});

it("uses one contextual emergency control below a narrower Stop and includes the speed slider", () => {
  const r = new ManipulationRenderer();
  applyRenderer(r, state, origin, "arm", true, null, null, null, 1, "");
  const stop = r.panel.children.find(
    (c) => c.userData.manipulationAction === "stop",
  ) as any;
  const emergency = r.panel.children.find(
    (c) => c.userData.manipulationAction === "estop",
  ) as any;
  expect(stop.position.y).toBeGreaterThan(emergency.position.y);
  expect(stop.rangeX).toBeLessThan(emergency.rangeX);
  expect(r.owns(r.speedSlider.hit)).toBe(true);
  expect(r.speedSlider.position.y).toBeGreaterThan(stop.position.y);
  applyRenderer(
    r,
    { ...state, stopped: true, stop_confirmed: true },
    origin,
    "arm",
    true,
    null,
    null,
    null,
    1.1,
    "",
  );
  expect(emergency.userData.manipulationAction).toBe("resume");
  expect(emergency.text).toBe("Resume operation");
  expect(
    r.panel.children.filter((c) =>
      ["estop", "resume"].includes(c.userData.manipulationAction),
    ),
  ).toHaveLength(1);
  expect(emergency.enabled).toBe(true);
  applyRenderer(
    r,
    { ...state, stopped: true, stop_confirmed: false },
    origin,
    "arm",
    true,
    null,
    null,
    null,
    1.2,
    "",
  );
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
    applyRenderer(
      r,
      s,
      origin,
      "arm",
      true,
      target,
      null,
      null,
      now,
      "",
      fresh,
    );
  const startDistance = () => {
    const start = r.path.geometry.getAttribute("instanceStart");
    return Math.hypot(start.getX(0), start.getY(0), start.getZ(0));
  };
  apply(1);
  s.observations!.arm.joints.fixed = 0.5;
  s.observations!.arm.pose = { ...pose, position: [0.5, 0, 0] };
  apply(1.05);
  expect(startDistance()).toBeCloseTo(0.5);
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
    applyRenderer(
      r,
      arm,
      origin,
      "arm",
      false,
      target,
      solution,
      null,
      1,
      "",
      true,
      "OpenYAM",
      intent,
    );
    const models = (r as any).modelRenderer;
    const moving = models.previewMeshes.get("gripper") as THREE.Mesh;
    const stationary = models.previewMeshes.get("link2") as THREE.Mesh;
    expect(moving.visible).toBe(true);
    expect((moving.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeGreaterThan(0);
    expect(stationary.visible).toBe(false);
    expect(r.object.getObjectByName("LinkBounds_link3")).toBeUndefined();
    rejection = { revision: 1, pose: target, message: "IK failed" };
    applyRenderer(
      r,
      arm,
      origin,
      "arm",
      false,
      target,
      solution,
      null,
      1.1,
      "IK failed",
      true,
      "OpenYAM",
      intent,
    );
    expect(
      (moving.children.find(c => c.userData.armOutline) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.uColor.value.getHex(),
    ).toBe(0xffcc00);
    applyRenderer(
      r,
      arm,
      origin,
      "arm",
      false,
      target,
      solution,
      null,
      3,
      "IK failed",
      true,
      "OpenYAM",
      intent,
    );
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
import type {
  ManipulationPlan,
  ManipulationPose,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import type { ManipulationPresentation } from "../src/manipulation/ManipulationRenderer";
let speedScale = 0.2;
let rejection: ManipulationPresentation["rejection"] = null;
function applyRenderer(
  renderer: ManipulationRenderer,
  state: ManipulationState,
  origin: ManipulationPresentation["origin"],
  groupId: string | null,
  selected: boolean,
  target: ManipulationPose | null,
  solution: Record<string, number> | null,
  plan: ManipulationPlan | null,
  now: number,
  status: string,
  fresh = true,
  robotTitle = "Arm",
  overrides: Partial<ManipulationSnapshot> = {},
): void {
  const intent = deriveManipulationSnapshot({
    available: state.available,
    fresh,
    selected,
    targetOffset: targetIsOffset(
      target,
      state.observations?.[groupId ?? ""]?.pose,
    ),
    gripperDraft: false,
    dragging: false,
    planning: false,
    executing: ["accepted", "executing"].includes(state.execution ?? ""),
    resetting: !!state.operation,
    stopped: state.stopped === true,
    stopConfirmed: state.stop_confirmed === true,
    pendingControl: false,
    following: state.following === true,
    rejection: rejection !== null,
    status,
    runtimeMessage: state.message,
  });
  renderer.apply({
    state,
    origin,
    groupId,
    selected,
    target,
    solution,
    plan,
    now,
    robotTitle,
    intent: { ...intent, ...overrides },
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
    applyRenderer(
      renderer,
      first,
      origin,
      "arm",
      true,
      null,
      null,
      null,
      1,
      "",
    );
    applyRenderer(
      renderer,
      second,
      origin,
      "arm",
      true,
      null,
      null,
      null,
      2,
      "",
    );
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
    applyRenderer(
      renderer,
      modelState,
      origin,
      "arm",
      true,
      target,
      null,
      null,
      1,
      "",
    );
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


it("reveals hidden mesh triangles on hover and keeps them selectable at zero opacity", () => {
  const load = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, loaded) => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial());
    mesh.name = "base"; scene.add(mesh); loaded({ scene } as never);
  });
  const r = new ManipulationRenderer();
  const s = structuredClone(state); s.model!.asset_url = "/arm.glb";
  let now = 1;
  const apply = (selected: boolean) => { applyRenderer(r, s, origin, "arm", selected, null, null, null, now += 1 / 60, ""); r.object.updateMatrixWorld(true); };
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
    expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeGreaterThan(0);
    expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBeLessThan(1);
    for (let i = 0; i < 80; i++) apply(false);
    expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBe(1);
    r.hoveredLink = null; apply(true);
    for (let i = 0; i < 80; i++) apply(true);
    expect(visual.visible).toBe(true); expect((visual.material as THREE.ShaderMaterial).uniforms.uOpacity.value).toBe(1);
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
    applyRenderer(r, state, origin, "arm", true, pose, null, null, 1, "");
    expect(r.measuredHandle.object.visible).toBe(true);
    expect(r.measuredHandle.collider.userData.interactionEnabled).toBe(false);
    expect(r.measuredHandle.collider.renderOrder).toBeGreaterThan(r.handle.collider.renderOrder);
  } finally { r.dispose(); }
});

it("replaces the near-EE gripper action with Execute only in selected mode", () => {
  const r = new ManipulationRenderer();
  try {
    r.eeHovered = true;
    const target = { ...pose, position: [0.1, 0, 0] as [number, number, number] };
    applyRenderer(r, state, origin, "arm", true, target, null, null, 1, "");
    const button = r.controlsView.buttons.get("gripper")!;
    expect(button.text).toBe("Execute");
    expect(button.userData.manipulationAction).toBe("execute");
    expect(r.gripperMenu.visible).toBe(true);
    applyRenderer(r, state, origin, "arm", false, target, null, null, 1.1, "");
    expect(button.text).toBe("Open"); expect(button.userData.manipulationAction).toBe("gripper");
  } finally { r.dispose(); }
});


it("uses full opacity for an executing path and planning opacity for its draft", () => {
  const r = new ManipulationRenderer();
  const target = { ...pose, position: [0.1, 0, 0] as [number, number, number] };
  try {
    applyRenderer(r, state, origin, "arm", true, target, null, null, 1, "");
    expect(r.path.material.uniforms.uOpacity.value).toBe(0.5);
    const moving = { ...state, execution: "executing" };
    applyRenderer(r, moving, origin, "arm", true, target, null, null, 1.1, "");
    expect(r.path.material.uniforms.uOpacity.value).toBe(1);
  } finally { r.dispose(); }
});
