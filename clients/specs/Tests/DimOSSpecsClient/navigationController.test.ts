import { setMockTime } from "../setup/lens-globals";
import { describe, expect, it } from "vitest";
import { clientTrackingToOdomPose, rotateVecByQuat, odomToClientTrackingYawPose } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms";
import { clientTrackingToSpecsYawPose } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import {
  FOLLOW_FLOOR_POSITION_EPSILON_CM,
  shouldSyncFollowFloorPose,
} from "../../Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement";
import { specsNavigationPoseInTracking } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavigationController";
import { SpecsNavigationInput } from "../../Assets/Scripts/DimOSSpecsClient/navigation/SpecsNavigationInput";
describe("shouldSyncFollowFloorPose", () => {
  const identity = quat.quatIdentity();

  it("skips updates inside the position and rotation epsilon", () => {
    expect(
      shouldSyncFollowFloorPose(
        { position: new vec3(0, 0, 0), rotation: identity },
        { position: new vec3(FOLLOW_FLOOR_POSITION_EPSILON_CM, 0, 0), rotation: identity },
      ),
    ).toBe(false);
    expect(
      shouldSyncFollowFloorPose(
        { position: new vec3(0, 0, 0), rotation: identity },
        { position: new vec3(FOLLOW_FLOOR_POSITION_EPSILON_CM + 0.01, 0, 0), rotation: identity },
      ),
    ).toBe(true);
  });
});

describe("navigation marker terminal heading", () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    "sends the displayed arrow direction at marker yaw %s, with a rotated localization origin",
    (yaw) => {
      const origin = {
        position: [2, -1, 0.2] as [number, number, number],
        orientation: [0, 0, Math.sin(0.37 / 2), Math.cos(0.37 / 2)] as [number, number, number, number],
        confidence: 1, ts: 1,
      };
      const rotation = new quat(Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0);
      const goal = clientTrackingToOdomPose(specsNavigationPoseInTracking(new vec3(25, 10, -100), rotation), origin);
      // Lens arrow (cos(yaw), 0, -sin(yaw)) maps to tracking
      // (sin(yaw), -cos(yaw), 0), then rotates by the odom origin.
      const actual = rotateVecByQuat(goal.orientation, [1, 0, 0]);
      const expected = rotateVecByQuat(origin.orientation, [Math.sin(yaw), -Math.cos(yaw), 0]);
      actual.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 6));
      const echoed = clientTrackingToSpecsYawPose(odomToClientTrackingYawPose([
        goal.position[0], goal.position[1], goal.position[2],
        Math.atan2(actual[1], actual[0]),
      ], origin));
      expect(Math.cos(echoed[3])).toBeCloseTo(Math.cos(yaw), 6);
      expect(Math.sin(echoed[3])).toBeCloseTo(Math.sin(yaw), 6);
      expect(echoed.slice(0, 3)).toEqual(expect.arrayContaining([
        expect.closeTo(25, 6), expect.closeTo(10, 6), expect.closeTo(-100, 6),
      ]));
    },
  );
});

import { NavigationController } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavigationController";
import { vi } from "vitest";

it("removes invalid floor probes independently and cancels only their draft owner", () => {
  let hits = [{ position: new vec3(0, 0, -100), normal: new vec3(0, 1, 0) }];
  const view: any = { connection: "ready", hasTrackingOrigin: true, nav: null, nav_goal: null,
    capabilities: { navigation: { available: true, nav_goal: { available: true } } }, state: null };
  const origin: any = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
  const controller = new NavigationController({ session: { view: () => view, sendText: vi.fn() } as any,
    deviceTracking: { worldOptions: {}, raycastWorldMesh: () => hits } as any,
    robotPresenter: { floorPose: () => null, deadzoneRadiusCm: () => null, floorWorldY: () => 0 } as any,
    parent: {} as SceneObject, cameraObject: {} as SceneObject, navGoalMarkerPrefab: {} as ObjectPrefab });
  controller.applyView(view, origin); controller.setSelected(true);
  const from = new vec3(0, 100, 0), direction = new vec3(0, -1, -1);
  controller.aim("left", from, direction); controller.aim("right", from, direction);
  expect(controller.interaction.snapshot().probes).toHaveLength(2);
  controller.hold("left", from, direction, false);
  controller.cancelSource("left");
  expect(controller.interaction.snapshot().draft).toBeNull();
  expect(controller.interaction.snapshot().probes.map(p => p.sourceId)).toEqual(["right"]);
  hits = []; controller.aim("right", from, direction);
  expect(controller.interaction.snapshot().probes).toHaveLength(1); // Stable floor survives scan gaps.
  hits = [{ position: new vec3(0, 0, -100), normal: new vec3(0, 1, 0) }];
  controller.aim("right", from, direction);
  controller.aim("right", from, vec3.zero());
  expect(controller.interaction.snapshot().probes).toEqual([]);
  for (const invalid of [
    { position: new vec3(0, 0, -100), normal: new vec3(0, 0, 1) },
    { position: new vec3(0, 40, -100), normal: new vec3(0, 1, 0) },
    { position: new vec3(0, 0, 100), normal: new vec3(0, 1, 0) },
    { position: new vec3(0, 0, -1000), normal: new vec3(0, 1, 0) },
  ]) {
    hits = [{ position: new vec3(0, 0, -100), normal: new vec3(0, 1, 0) }];
    controller.aim("right", from, direction);
    expect(controller.interaction.snapshot().probes).toHaveLength(1);
    hits = [invalid]; controller.aim("right", from, direction);
    expect(controller.interaction.snapshot().probes).toEqual([]);
  }
});

it.each([false, true])("streams marker drags across frames with selection %s across replans and feedback", selected => {
  let point = new vec3(0, 0, -100);
  const cast = vi.fn(() => [{ position: point, normal: new vec3(0, 1, 0) }]);
  const options: any = {};
  const view: any = { connection: "ready", hasTrackingOrigin: true, nav: null, nav_goal: null,
    capabilities: { navigation: { available: true, nav_goal: { available: true } } }, state: null };
  const origin: any = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
  const sendText = vi.fn();
  const controller = new NavigationController({ session: { view: () => view, sendText } as any,
    deviceTracking: { worldOptions: options, raycastWorldMesh: cast } as any,
    robotPresenter: { floorPose: () => ({ position: new vec3(0, 0, -100), rotation: quat.quatIdentity() }),
      deadzoneRadiusCm: () => null, floorWorldY: () => 0 } as any,
    parent: {} as SceneObject, cameraObject: {} as SceneObject, navGoalMarkerPrefab: {} as ObjectPrefab });
  controller.applyView(view, origin);
  const from = new vec3(0, 100, 0), ray = new vec3(0, -1, -1);
  controller.aim("left", from, ray); controller.aim("right", from, ray);
  controller.release("left", from, ray);
  expect(cast).not.toHaveBeenCalled(); expect(options.enableWorldMeshesTracking).toBe(false);
  view.capabilities.estop = { available: true };
  view.nav_goal = { type: "nav_goal", ts: 1, pose: [1, 0, 0, 0], path_poses: [] };
  view.nav = { state: "following_path", outcome: null };
  controller.applyView(view, origin); controller.setSelected(selected);
  const marker = {} as SceneObject, body = {} as SceneObject;
  const hand = { inputType: 1, startPoint: from, direction: ray, isActive: () => true,
    isTriggering: true, currentInteractable: { getSceneObject: () => marker } };
  vi.spyOn(controller, "ownsMarkerTarget").mockImplementation(target => target === marker);
  const input = new SpecsNavigationInput(controller, { ownsTarget: target => target === body, setHovered: vi.fn() }, () => [hand]);
  vi.stubGlobal("deviceInfoSystem", { isEditor: () => false });
  setMockTime(0); input.tick();
  point = new vec3(30, 0, -600);
  hand.direction = new vec3(0.3, -1, -6);
  hand.currentInteractable.getSceneObject = () => body;
  setMockTime(1 / 60); input.tick();
  const displayed = controller.currentPose()!.position;
  expect(displayed.distance(point)).toBeGreaterThan(1);
  expect(controller.interaction.isDragging()).toBe(true);
  expect(sendText).toHaveBeenCalled();
  expect(options.enableWorldMeshesTracking).toBe(true);
  const markerView = { setPose: vi.fn(), show: vi.fn(), hide: vi.fn(), setDragEnabled: vi.fn(),
    setCancelVisible: vi.fn(), applyWorldStyle: vi.fn(), orientViewer: vi.fn(), circleOpacity: () => 0.6 };
  (controller as any).marker = markerView;
  (controller as any).deps.cameraObject = { getTransform: () => ({ getWorldPosition: () => vec3.zero() }) };
  // Delayed echoes and replans must update the route without moving the held marker.
  for (let ts = 2; ts <= 4; ts++) {
    view.nav_goal = { type: "nav_goal", ts, pose: [1, 0, 0, 0],
      path_poses: ts === 3 ? [] : [[0, 0, 0, 0], [1, 0, 0, 0]] };
    view.nav = { state: "following_path", outcome: null };
    controller.applyView(view, origin); controller.tick(0.016);
    expect(controller.interaction.isDragging()).toBe(true);
    expect(markerView.setPose.mock.lastCall?.[0]).toEqual(displayed);
    expect(markerView.setDragEnabled).toHaveBeenLastCalledWith(true);
  }
  // A terminal fact from an executing goal can arrive between drag stream sends.
  view.nav = { state: "resolved", outcome: "succeeded" };
  controller.applyView(view, origin); controller.tick(0.016);
  expect(markerView.setDragEnabled).toHaveBeenLastCalledWith(true);
  expect(markerView.applyWorldStyle.mock.lastCall?.[0].flash).toBeNull();
  sendText.mockClear();
  hand.isTriggering = false; input.tick();
  expect(controller.interaction.isDragging()).toBe(false);
  expect(sendText).toHaveBeenCalledOnce(); // Final forced goal survives unselected release.
  // Rendering is covered separately; this fixture exercises input and mesh tracking.
  (controller as any).render = () => {};
  controller.setInputEnabled(false);
  expect(options.enableWorldMeshesTracking).toBe(false);
});

it("keeps direct dragging continuous across scanned robot surfaces without allowing floor placement on them", () => {
  let hit = { position: new vec3(0, 0, -100), normal: new vec3(0, 1, 0) };
  const view: any = { connection: "ready", hasTrackingOrigin: true, nav: null, nav_goal: null,
    capabilities: { estop: { available: true }, navigation: { available: true, nav_goal: { available: true } } }, state: null };
  const origin: any = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
  const controller = new NavigationController({ session: { view: () => view, sendText: vi.fn() } as any,
    deviceTracking: { worldOptions: {}, raycastWorldMesh: () => [hit] } as any,
    robotPresenter: { floorPose: () => ({ position: new vec3(0, 0, -100), rotation: quat.quatIdentity() }),
      worldPosition: () => new vec3(0, 0, -100), deadzoneRadiusCm: () => 50, floorWorldY: () => 0 } as any,
    parent: {} as SceneObject, cameraObject: {} as SceneObject, navGoalMarkerPrefab: {} as ObjectPrefab });
  controller.applyView(view, origin);
  const from = new vec3(0, 100, 0);
  let time = 0; setMockTime(time);
  controller.hold("left", from, new vec3(0, -1, -1), true);
  for (const x of [15, 20, 30, 40]) {
    // The robot's top/side replaces the floor hit while the pinch continues.
    hit = { position: new vec3(x / 2, 50, -50), normal: new vec3(0, 0, 1) };
    for (let i = 0; i < 30; i++) {
      setMockTime(time += 1 / 60);
      controller.hold("left", from, new vec3(x / 100, -1, -1), true);
    }
    expect(controller.interaction.isDragging()).toBe(true);
    const expected = specsNavigationPoseInTracking(new vec3(x, 0, -100), quat.quatIdentity()).position;
    controller.interaction.snapshot().position.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 2));
  }
  (controller as any).render = () => {};
  controller.cancelDrag(); controller.setSelected(true);
  controller.aim("right", from, new vec3(0, -1, -1));
  expect(controller.interaction.snapshot().probes).toEqual([]);
  // Direct dragging stays on its plane even where the room scan is not floor.
  controller.hold("left", from, new vec3(2, -1, -1), true);
  for (let i = 0; i < 30; i++) { setMockTime(time += 1 / 60); controller.hold("left", from, new vec3(2.3, -1, -1), true); }
  expect(controller.interaction.isDragging()).toBe(true);
});

it("rejects direct drag intersections outside the queried 20 metre ray segment", () => {
  const controller = new NavigationController({ session: { requestEstop() {} } as any,
    deviceTracking: { worldOptions: {}, raycastWorldMesh: () => [] } as any,
    robotPresenter: {} as any, cameraObject: {} as any, parent: {} as any, navGoalMarkerPrefab: {} as any });
  (controller as any).currentPose = () => ({ position: vec3.zero(), rotation: quat.quatIdentity() });
  const place = (from: vec3, direction: vec3) => (controller as any).place("left", from, direction, false);
  expect(place(new vec3(0, 100, 0), new vec3(0, -0.001, -1))).toBeNull();
  expect(place(new vec3(0, 100, 0), new vec3(0, -1, -1))).not.toBeNull();
  expect(place(new vec3(NaN, 100, 0), new vec3(0, -1, -1))).toBeNull();
});

it("keeps an edge grab anchored instead of dragging the circle center to the pinch ray", () => {
  const view: any = { connection: "ready", hasTrackingOrigin: true, nav: null, nav_goal: null,
    capabilities: { estop: { available: true }, navigation: { nav_goal: { available: true } } } };
  const controller = new NavigationController({ session: { view: () => view, sendText: vi.fn() } as any,
    deviceTracking: { worldOptions: {}, raycastWorldMesh: () => [] } as any,
    robotPresenter: { floorPose: () => ({ position: new vec3(0, 0, -100), rotation: quat.quatIdentity() }) } as any,
    parent: {} as any, cameraObject: {} as any, navGoalMarkerPrefab: {} as any });
  const origin: any = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
  controller.applyView(view, origin); const from = new vec3(0, 100, 0);
  for (let i = 0; i < 60; i++) { setMockTime(i / 60); controller.hold("left", from, new vec3(.15, -1, -1), true); }
  expect(controller.interaction.isDragging()).toBe(false);
  expect(controller.currentPose()!.position).toEqual(new vec3(0, 0, -100));
  for (let i = 60; i < 120; i++) { setMockTime(i / 60); controller.hold("left", from, new vec3(.45, -1, -1), true); }
  expect(controller.interaction.isDragging()).toBe(true);
  expect(controller.currentPose()!.position.x).toBeCloseTo(30, 1);
});

it("does not place an attached marker at world zero while the robot floor is still unknown", () => {
  let floor: { position: vec3; rotation: quat } | null = null;
  const view: any = { connection: "ready", hasTrackingOrigin: true, nav: null, nav_goal: null,
    capabilities: { navigation: { nav_goal: { available: true } } } };
  const controller = new NavigationController({ session: { view: () => view } as any,
    deviceTracking: { worldOptions: {}, raycastWorldMesh: () => [] } as any,
    robotPresenter: { floorPose: () => floor, floorWorldY: () => floor?.position.y ?? null } as any,
    parent: {} as any, cameraObject: {} as any, navGoalMarkerPrefab: {} as any });
  const origin: any = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
  controller.applyView(view, origin); expect(controller.isArmed()).toBe(false);
  floor = { position: new vec3(0, 8, -100), rotation: quat.quatIdentity() };
  controller.applyView(view, origin); expect(controller.isArmed()).toBe(true);
  expect(controller.currentPose()!.position.y).toBe(8);
});
