import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { deriveRobotMarkerApplyInput } from "../src/presentation/RobotMarkerState";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities } from "@dimos-ar-client/websocket/protocolTypes";
import { WebXRRobotPresenter } from "../src/presentation/WebXRRobotPresenter";
import { ROBOT_LINE_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";

const capabilities: Capabilities = {
  lidar: { available: true, reason: null },
  localization: { available: true, reason: null },
  estop: { available: true, reason: null },
  agent: { available: true, reason: null },
  navigation: {
    available: true,
    reason: null,
    nav_goal: { available: true, reason: null },
    nav_joystick: { available: true, reason: null },
  },
};

function view(overrides: Partial<ARModuleSessionState> = {}): ARModuleSessionState {
  return {
    connection: "ready",
    hasTrackingOrigin: false,
    hello: {
      type: "hello",
      client_id: "c",
      time_sync: { ts_client: 0, ts_server: 0 },
      robot: {
        display_name: "Go2",
        body_bounds_m: [0.7, 0.5, 0.55],
        footprint_m: [0.7, 0.3],
        base_height_m: 0.33,
      },
      capabilities,
    },
    state: null,
    pose: null,
    nav_goal: null,
    lidar: null,
    capabilities,
    nav: null,
    agentMessage: null,
    agentMessageRevision: 0,
    lastError: null,
    ...overrides,
  };
}

describe("robot presentation", () => {
  it("keeps an unlocalized fallback after setup and uses base_height_m for the floor", () => {
    expect(deriveRobotMarkerApplyInput({ setupCompleted: false, view: view(), origin: null }).mode).toBe(
      "hidden",
    );
    expect(deriveRobotMarkerApplyInput({ setupCompleted: true, view: view(), origin: null }).mode).toBe(
      "unlocalizedFallbackPosition",
    );
    const robot = new WebXRRobotPresenter();
    const origin = {
      position: [0, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
      confidence: 1,
      ts: 0,
    };
    robot.apply(
      view({
        hasTrackingOrigin: true,
        pose: { type: "pose", position: [0, 0, 0], orientation: [0, 0, 0, 1], ts: 0 },
      }),
      origin,
      true,
      null,
    );
    const floor = robot.floorPose();
    expect(floor).not.toBeNull();
    robot.object.updateWorldMatrix(true, true);
    const gizmo = robot.object.getObjectByName("RobotPoseGizmo")!;
    expect(gizmo.children).toHaveLength(6);
    expect(gizmo.scale.x).toBe(0.8);
    expect(gizmo.visible).toBe(false);
    expect(robot.object.getObjectByName("RobotIndicator")!.visible).toBe(true);
    robot.setDebug(true);
    expect(gizmo.visible).toBe(true);
    const label = robot.object.getObjectByName("RobotMarkerLabel")!;
    expect(label.scale.x).toBe(1);
    robot.feedback({ tone: "success", aligned: true, activity: "Idle", message: null });
    expect(label.children).toHaveLength(4);
    robot.feedback({ tone: "success", aligned: true, activity: "Thinking", message: "Ignored speech copy" });
    expect((label.children[2] as { text?: string }).text).toBe("Thinking");
    expect((label.children[2] as unknown as { fontSize: number }).fontSize).toBeGreaterThan((label.children[1] as unknown as { fontSize: number }).fontSize);
    const axes = [
      { direction: [0, 0, -1], color: 0xff0000 },
      { direction: [-1, 0, 0], color: 0x00ff00 },
      { direction: [0, 1, 0], color: 0x0000ff },
    ];
    axes.forEach(({ direction, color }, index) => {
      const shaft = gizmo.children[index * 2] as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
      expect(shaft.material.color.getHex()).toBe(color);
      const actual = new THREE.Vector3(0, 1, 0).applyQuaternion(shaft.quaternion);
      actual.toArray().forEach((value, axis) => expect(value).toBeCloseTo(direction[axis]));
    });
    const circle = robot.object.getObjectByName("Robot floor circle") as THREE.Mesh<THREE.RingGeometry>;
    expect(circle.geometry.parameters.outerRadius).toBe(0.06);
    expect(robot.object.getObjectByName("RobotMarkerLabel")).toBeDefined();
    expect(robot.collider.material.visible).toBe(false);
    const dx = floor!.position[0] - robot.object.position.x;
    const dy = floor!.position[1] - robot.object.position.y;
    const dz = floor!.position[2] - robot.object.position.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(0.33);
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx));
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dz));
    robot.orientFeedback(new THREE.Vector3(1, 1.8, -1));
    robot.object.updateWorldMatrix(true, true);
    const labelRotation = new THREE.Euler().setFromQuaternion(label.getWorldQuaternion(new THREE.Quaternion()), "YXZ");
    expect(labelRotation.z).toBeCloseTo(0);
    robot.dispose();
  });
});

it("smooths robot motion with Specs position and rotation rates and snaps fresh alignment", () => {
  const robot = new WebXRRobotPresenter();
  const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } as const;
  const pose = { type: "pose", position: [0, 0, 0.33], orientation: [0, 0, 0, 1], ts: 0 } as const;
  const initial = view({ hasTrackingOrigin: true, pose: { ...pose, position: [...pose.position], orientation: [...pose.orientation] } });
  const aligned: ClientTrackingOrigin = { ...origin, position: [...origin.position], orientation: [...origin.orientation] };
  robot.apply(initial, aligned, true, null);
  const next = view({ ...initial, pose: { ...initial.pose!, position: [1, 0, 0.33], orientation: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] } });
  robot.apply(next, aligned, true, null);
  expect(robot.object.position.z).toBeCloseTo(0);
  robot.tick(0.1);
  expect(robot.object.position.z).toBeCloseTo(-(1 - Math.exp(-0.8)));
  expect(robot.object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo((Math.PI / 2) * (1 - Math.exp(-0.45)));
  for (let i = 0; i < 50; i++) robot.tick(0.1);
  expect(robot.object.position.z).toBeCloseTo(-1);
  expect(robot.floorPose()!.position[1]).toBeCloseTo(0);
  robot.apply(next, { ...aligned, position: [0.5, 0, 0] }, true, null);
  expect(robot.object.position.z).toBeCloseTo(-0.5);
  robot.reset(); robot.apply(initial, aligned, true, null);
  expect(robot.object.position.z).toBeCloseTo(0);
  robot.dispose();
});

it("orients the invisible body collider with the robot and reverses the outline fade without losing selection", () => {
  const robot = new WebXRRobotPresenter();
  robot.object.visible = true;
  // Drive the dimensions through the same hello/view boundary as localization.
  const v = view();
  v.pose = { type: "pose", position: [1, 2, 0.33], orientation: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)], ts: 1 };
  v.hasTrackingOrigin = true;
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  robot.apply(v, origin, true, null);
  expect(robot.collider.scale.toArray()).toEqual([0.5, 0.55, 0.7]);
  expect(robot.collider.position.y - robot.collider.scale.y / 2).toBeCloseTo(-0.33);
  robot.object.updateMatrixWorld(true);
  expect(robot.collider.getWorldQuaternion(new THREE.Quaternion()).angleTo(robot.object.quaternion)).toBeCloseTo(0);
  const outline = robot.object.getObjectByName("Robot selection outline") as THREE.LineSegments<THREE.EdgesGeometry, THREE.LineDashedMaterial>;
  expect(outline.geometry.getAttribute("position").count).toBe(24);
  expect(outline.material).toBeInstanceOf(THREE.LineDashedMaterial);
  expect(outline.material.dashSize).toBe(ROBOT_LINE_STYLE.dashM);
  expect(outline.material.gapSize).toBe(ROBOT_LINE_STYLE.gapM);
  expect(outline.geometry.getAttribute("lineDistance").count).toBe(24);
  expect(outline.material.opacity).toBe(0);
  const center = robot.collider.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1));
  ray.layers.set(1);
  expect(ray.intersectObject(robot.object, true).some(hit => hit.object === robot.collider)).toBe(true);
  robot.setHovered(true); robot.tick(0.075);
  const hoverOpacity = outline.material.opacity;
  expect(hoverOpacity).toBeGreaterThan(0); expect(hoverOpacity).toBeLessThan(0.45);
  robot.setHovered(false); robot.tick(0.0375);
  expect(outline.material.opacity).toBeGreaterThan(0); expect(outline.material.opacity).toBeLessThan(hoverOpacity);
  robot.setSelected(true); robot.tick(0.15);
  robot.setHovered(true); robot.setHovered(false); robot.tick(0.15);
  expect(outline.material.opacity).toBeCloseTo(0.80, 2);
  expect(robot.isSelected()).toBe(true);
  robot.object.quaternion.setFromEuler(new THREE.Euler(0.3, 0.4, 0.2));
  robot.tick(0.01);
  robot.object.updateMatrixWorld(true);
  const circle = robot.object.getObjectByName("Robot floor circle")!;
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(circle.getWorldQuaternion(new THREE.Quaternion()));
  expect(normal.y).toBeCloseTo(1);
  const circlePosition = circle.getWorldPosition(new THREE.Vector3());
  expect(circlePosition.x).toBeCloseTo(robot.object.position.x);
  expect(circlePosition.z).toBeCloseTo(robot.object.position.z);
  expect(circlePosition.y).toBeCloseTo(robot.floorWorldY()! + 0.001);
  robot.reset(); expect(robot.isSelected()).toBe(false);
  robot.dispose();
});

it("fades its floor circle only when navigation is detached and places the label above the sphere", () => {
  const robot = new WebXRRobotPresenter(); robot.apply(view(), null, true, [0, 1, -2]);
  const circle = robot.object.getObjectByName("Robot floor circle") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  robot.tick(1); expect(circle.visible).toBe(false);
  robot.setFloorVisible(true); robot.tick(0.03); expect(circle.material.opacity).toBeGreaterThan(0); expect(circle.material.opacity).toBeLessThan(0.75);
  robot.tick(1); expect(circle.material.opacity).toBeCloseTo(0.35);
  robot.setFloorVisible(false); robot.tick(1); expect(circle.visible).toBe(false);
  expect(robot.object.getObjectByName("RobotMarkerLabel")!.position.y).toBeCloseTo(0.075);
  robot.dispose();
});

it("unfolds horizontally from the floor before rising, reverses on hide, and keeps the collider fixed", () => {
  const robot = new WebXRRobotPresenter(); robot.apply(view(), null, true, [0, 1, -2]); robot.tick(0);
  const outline = robot.object.getObjectByName("Robot selection outline")!;
  const colliderScale = robot.collider.scale.clone(), colliderPosition = robot.collider.position.clone();
  expect(outline.scale.toArray()).toEqual([0, 0, 0]);
  robot.setHovered(true); robot.tick(0.06);
  expect(outline.scale.x).toBeGreaterThan(0); expect(outline.scale.y).toBe(0);
  expect(outline.position.y).toBeCloseTo(-0.33);
  robot.tick(0.06); expect(outline.scale.x).toBe(1); expect(outline.scale.y).toBeGreaterThan(0); expect(outline.scale.y).toBeLessThan(1);
  expect(outline.position.y - 0.55 * outline.scale.y / 2).toBeCloseTo(-0.33);
  robot.tick(0.12); expect(outline.scale.toArray()).toEqual([1, 1, 1]);
  robot.setHovered(false); robot.tick(0.06); expect(outline.scale.x).toBe(1); expect(outline.scale.y).toBeLessThan(1);
  robot.tick(0.15); expect(outline.scale.y).toBe(0); expect(outline.scale.x).toBeLessThan(1);
  const before = outline.scale.x;
  robot.setSelected(true); robot.tick(0.01); expect(outline.scale.x).toBeGreaterThan(before);
  expect(robot.collider.scale).toEqual(colliderScale); expect(robot.collider.position).toEqual(colliderPosition);
  robot.reset(); expect(outline.scale.toArray()).toEqual([0, 0, 0]); robot.dispose();
});

it("keeps the collapsing box visible, uses physical selected strokes, centers text and ends its connector above the floor circle", () => {
  const robot = new WebXRRobotPresenter(); robot.apply(view(), null, true, [0, 1, -2]);
  robot.feedback({ tone: "success", aligned: true, activity: "Idle", message: null });
  const outline = robot.object.getObjectByName("Robot selection outline") as THREE.LineSegments<THREE.EdgesGeometry, THREE.LineDashedMaterial>;
  robot.setSelected(true); robot.tick(1);
  const selected = outline.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  expect(selected.material.uniforms.uWidth.value).toBeCloseTo(0.00275);
  expect(selected.material.uniforms.uOpacity.value).toBeCloseTo(0.8);
  robot.setSelected(false); robot.tick(0.1);
  expect(outline.scale.y).toBeGreaterThan(0); expect(outline.scale.y).toBeLessThan(1);
  expect(outline.material.opacity).toBeGreaterThan(0.45); expect(outline.material.opacity).toBeLessThan(0.5);
  robot.tick(0.25); expect(outline.scale.toArray()).toEqual([0, 0, 0]); expect(outline.material.opacity).toBe(0);
  const label = robot.object.getObjectByName("RobotMarkerLabel")!;
  for (const child of label.children.slice(1)) expect((child as unknown as { anchorX: string }).anchorX).toBe("center");
  const sphere = robot.object.getObjectByName("RobotIndicator") as THREE.Mesh<THREE.SphereGeometry>;
  expect(sphere.geometry.parameters.radius).toBe(0.03);
  robot.setConnectorFloorY(0.8); robot.setSelected(true); robot.tick(1); robot.object.updateMatrixWorld(true);
  const connector = robot.object.getObjectByName("Robot floor connector") as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  const endpoint = new THREE.Vector3().fromBufferAttribute(connector.geometry.getAttribute("instanceEnd"), 0).applyMatrix4(connector.matrixWorld);
  expect(endpoint.y).toBeGreaterThanOrEqual(0.8);
  expect(connector.material.uniforms.uWidth.value).toBeCloseTo(0.00275);
  robot.setSelected(false); robot.tick(1); expect(connector.visible).toBe(true);
  robot.dispose();
});

it("plays the exact same box animation backward over the same duration", () => {
  const robot = new WebXRRobotPresenter(); robot.apply(view(), null, true, [0, 1, -2]);
  const outline = robot.object.getObjectByName("Robot selection outline")!;
  robot.setHovered(true); robot.tick(0.06); const quarter = outline.scale.clone();
  robot.tick(0.18); robot.setHovered(false); robot.tick(0.18);
  expect(outline.scale.distanceTo(quarter)).toBeLessThan(1e-6);
  robot.tick(0.06); expect(outline.scale.length()).toBeCloseTo(0);
  robot.dispose();
});
