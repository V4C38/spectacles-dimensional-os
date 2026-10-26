import { describe, expect, it } from "vitest";
import { clientTrackingToOdomPose, rotateVecByQuat, odomToClientTrackingYawPose } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingTransforms";
import { clientTrackingToSpecsYawPose } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import {
  FOLLOW_FLOOR_POSITION_EPSILON_CM,
  shouldSyncFollowFloorPose,
} from "../../Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement";
import { specsNavigationPoseInTracking } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavigationController";
import { shouldBeginFailedFlash } from "../../Assets/Scripts/DimOSARClient/navigation/NavigationInteraction";

describe("shouldBeginFailedFlash", () => {
  const failed = { state: "resolved" as const, outcome: "failed" as const };
  const following = { state: "following_path" as const, outcome: null };

  it("fires on the rising edge of resolved failed while a live goal exists", () => {
    expect(shouldBeginFailedFlash(following, failed, true)).toBe(true);
    expect(shouldBeginFailedFlash(null, failed, true)).toBe(true);
  });

  it("does not re-arm while still resolved failed, or without a live goal", () => {
    expect(shouldBeginFailedFlash(failed, failed, true)).toBe(false);
    expect(shouldBeginFailedFlash(following, failed, false)).toBe(false);
    expect(shouldBeginFailedFlash(following, following, true)).toBe(false);
  });
});

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
  expect(controller.interaction.snapshot().probes).toEqual([]);
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

it("streams unselected marker drags across frames and never raycasts unselected idle aim", () => {
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
  controller.hold("left", from, ray, true);
  point = new vec3(30, 0, -100); controller.setSelected(false);
  controller.hold("left", from, ray, true);
  expect(controller.interaction.isDragging()).toBe(true);
  expect(sendText).toHaveBeenCalled();
  expect(options.enableWorldMeshesTracking).toBe(true);
  // Rendering is covered separately; this fixture exercises input and mesh tracking.
  (controller as any).render = () => {};
  controller.setInputEnabled(false);
  expect(options.enableWorldMeshesTracking).toBe(false);
});
