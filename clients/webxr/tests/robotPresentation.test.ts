import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { deriveRobotMarkerApplyInput } from "../src/presentation/robotPresentation";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Capabilities } from "@dimos-ar-client/websocket/protocolTypes";
import { WebXRRobotPresenter, WebXRLidarRenderer, WebXRRouteRenderer } from "../src/presentation/WebXRPresenters";

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
    expect(robot.object.getObjectByName("RobotMarkerLabel")!.scale.x).toBe(0.25);
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
    robot.object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        expect(child.geometry).not.toBeInstanceOf(THREE.RingGeometry);
        expect(child.geometry).not.toBeInstanceOf(THREE.CircleGeometry);
      }
    });
    expect(robot.object.getObjectByName("RobotMarkerLabel")).toBeDefined();
    expect(robot.object.children.some(child => child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry)).toBe(false);
    const dx = floor!.position[0] - robot.object.position.x;
    const dy = floor!.position[1] - robot.object.position.y;
    const dz = floor!.position[2] - robot.object.position.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(0.33);
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx));
    expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dz));
    robot.orientFeedback(new THREE.Vector3(1, 1.8, -1));
    const label = robot.object.getObjectByName("RobotMarkerLabel")!;
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

it("updates the entire route as its segment count grows and shrinks", () => {
  const route = new WebXRRouteRenderer();
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0]], origin, true, 0, 0);
  const shortGeometry = route.object.geometry;
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0], [1, 0, 0, 0], [5, 0, 0, 0]], origin, true, 0, 0);
  expect(route.object.geometry).not.toBe(shortGeometry);
  const geometry = route.object.geometry;
  const ends = geometry.getAttribute("instanceEnd");
  expect(ends.getZ(ends.count - 1)).toBeCloseTo(-5);
  expect(geometry.instanceCount).toBe(ends.count);
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0], [1, 0, 0, 0], [6, 0, 0, 0]], origin, true, 0, 0);
  expect(route.object.geometry).toBe(geometry);
  expect(ends.getZ(ends.count - 1)).toBeCloseTo(-6);
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0]], origin, true, 0, 0);
  expect(route.object.geometry.instanceCount).toBe(1);
  route.dispose();
});

it("renders LiDAR before UI without writing depth that can occlude panels", () => {
  const lidar = new WebXRLidarRenderer();
  expect(lidar.object.renderOrder).toBeLessThan(0);
  expect((lidar.object.material as THREE.PointsMaterial).depthWrite).toBe(false);
  lidar.dispose();
});
