// @vitest-environment jsdom
import "./fixtures/xrEnvironment";
import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { WebXRManipulationController } from "../src/manipulation/WebXRManipulationController";
import { immediateAuthority } from "../../specs/Tests/fixtures/ImmediateAuthority";
import type { ManipulationState } from "@dimos-ar-client/manipulation/ManipulationTypes";

it("keeps the recorded model at measured EOF poses while stale feedback disables commands", () => {
  const pose = { position: [0,0,0] as [number,number,number], orientation: [0,0,0,1] as [number,number,number,number] };
  const scene = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.03,.03,.03), new THREE.MeshBasicMaterial());
  mesh.name = "tool"; scene.add(mesh);
  const load = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, done) => { done({ scene } as never); return undefined as never; });
  const recorded: ManipulationState = { type: "manipulation_state", available: true, read_only: true,
    root_pose: pose, model: { revision: "recorded", root: "base", asset_url: "/recording.glb", gripper_joints: {},
      links: [{ name: "base", bounds: null }, { name: "tool", bounds: null }],
      joints: [{ name: "slide", kind: "prismatic", parent: "base", child: "tool", axis: [1,0,0], origin: pose, mimic: null }] },
    groups: [{ id: "arm", joint_names: ["slide"], base_frame: "base", tip_frame: "tool", has_gripper: true, following: false }],
    observations: { arm: { joints: { slide: .4 }, measured_at: 0, pose: { ...pose, position: [.4,0,0] }, gripper: 0 } } };
  const sendText = vi.fn(), authority = immediateAuthority({ now: () => 100 });
  const session = { sendText, requestEstop: vi.fn(), subscribeOutbound: () => () => {}, collaboration: authority.collaboration,
    view: () => ({ connection: "ready", manipulation: recorded, manipulationError: null,
      hello: { time_sync: { ts_client: 100, ts_server: 100 }, source: { read_only: true }, robot: { display_name: "Recorded arm" } },
      capabilities: { manipulation: { available: true }, localization: { available: false } } }) };
  const controller = new WebXRManipulationController(session as never, () => ({ ...pose, confidence: 1, ts: 0 }), () => 100);
  try {
    controller.tick(true); controller.tick(true);
    expect(controller.interaction.snapshot().fresh).toBe(false);
    expect(recorded.observations!.arm.measured_at).toBe(0);
    expect(controller.renderer.object.visible).toBe(true);
    expect(controller.renderer.measuredHandle.object.position.toArray()).toEqual([0,0,-.4]);
    const model = (controller.renderer as unknown as { modelRenderer: { previewMeshes: Map<string, THREE.Object3D> } }).modelRenderer;
    expect(model.previewMeshes.size).toBe(1);
    expect(model.previewMeshes.get("tool")!.position.z).toBeCloseTo(-.4);
    expect(model.previewMeshes.get("tool")!.visible).toBe(true);
    expect(controller.renderer.handle.collider.userData.interactionEnabled).toBe(false);
    for (const key of ["plan", "execute", "reset", "gripper", "stop", "estop"])
      expect(controller.renderer.controlsView.buttons.get(key)!.enabled).toBe(false);
    expect(controller.begin([0,0,0], [0,0,0,1])).toBe(false);
    expect(sendText).not.toHaveBeenCalled(); expect(authority.commands).toEqual([]);
  } finally { controller.dispose(); load.mockRestore(); }
});
