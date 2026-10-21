import { describe, expect, it, vi } from "vitest";
import {
  RobotPresenter,
  robotDeadzoneRadiusCm,
  robotFloorOffsetCm,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/RobotPresenter";
import { clientTrackingToSpecsPoint } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import type { RobotDescription, Vec3 } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

import { AppState } from "../../Assets/Scripts/DimOSSpecsClient/presentation/AppState";
import type { ARModuleSessionState } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";

const GO2: RobotDescription = {
  display_name: "Unitree Go2",
  body_bounds_m: [0.7, 0.5, 0.55],
  footprint_m: [0.7, 0.5],
  base_height_m: 0.33,
};

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

describe("robotFloorOffsetCm", () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])("aligns the floor arrow +X with robot forward at Lens yaw %s", (yaw) => {
    const rotation = new quat(Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0);
    const presenter = {
      robot: GO2,
      worldPosition: () => new vec3(10, 50, -20),
      worldRotation: () => rotation,
    } as unknown as RobotPresenter;
    const floor = RobotPresenter.prototype.floorPose.call(presenter)!;
    const arrow = floor.rotation.multiplyVec3(new vec3(1, 0, 0));
    const forward = rotation.multiplyVec3(new vec3(0, 0, -1));
    expect(arrow.x).toBeCloseTo(forward.x, 6);
    expect(arrow.z).toBeCloseTo(forward.z, 6);
    expect(floor.position.y).toBeCloseTo(17, 6);
  });

  it("uses a Go2 floor height when no robot description is available", () => {
    const presenter = {
      robot: null,
      worldPosition: () => new vec3(10, 50, -20),
      worldRotation: () => quat.quatIdentity(),
    } as unknown as RobotPresenter;
    const floor = RobotPresenter.prototype.floorPose.call(presenter)!;
    expect(floor.position.x).toBeCloseTo(10, 6);
    expect(floor.position.y).toBeCloseTo(17, 6);
    expect(floor.position.z).toBeCloseTo(-20, 6);
  });

  it("offsets from pose to floor using base_height_m", () => {
    expectVec3(robotFloorOffsetCm(GO2), clientTrackingToSpecsPoint([0, 0, -0.33]));
    expectVec3(robotFloorOffsetCm(GO2), [0, -33, 0]);
  });
});

describe("robotDeadzoneRadiusCm", () => {
  it("uses half the max footprint plus 20 cm, floored at 20", () => {
    expect(robotDeadzoneRadiusCm(GO2)).toBe(55);
    expect(
      robotDeadzoneRadiusCm({
        ...GO2,
        footprint_m: [0.1, 0.1],
      }),
    ).toBe(25);
    expect(
      robotDeadzoneRadiusCm({
        ...GO2,
        footprint_m: [0, 0],
      }),
    ).toBe(20);
  });
});


describe("activity survives pose presentation", () => {
  it.each([
    ["Listening", true, false, true],
    ["Responding", true, true, true],
    ["Thinking", true, false, false],
    ["Idle", false, false, true],
  ] as const)("preserves %s through localized and deferred fallback updates", (label, asrRunning, ttsPlaying, idle) => {
    const presenter = new RobotPresenter();
    const text = { text: "", textFill: { color: null } };
    const busy = { enabled: false };
    const idleVfx = { enabled: true };
    const root = { enabled: true };
    const transform = {
      setWorldPosition: vi.fn(), setWorldRotation: vi.fn(),
      getWorldPosition: () => new vec3(0, 0, 0),
      getWorldRotation: () => quat.quatIdentity(),
      getWorldScale: () => new vec3(1, 1, 1),
    };
    const motionRoot = { enabled: true, getTransform: () => transform };
    Object.assign(presenter, {
      getSceneObject: () => root,
      motionRoot, presented: true,
      titleText: { text: "", textFill: { color: null } }, stateInfoText: text,
      buttonVfxBusy: busy, buttonVfxIdle: idleVfx,
      unlocalizedPlaceEvent: { reset: vi.fn() },
    });
    const view = {
      connection: "ready", hello: { robot: GO2 },
      nav: null, state: { agent: { idle } },
    } as unknown as ARModuleSessionState;
    const appState = new AppState();
    const ctx = { mainUi: motionRoot as unknown as SceneObject, appState };
    presenter.refreshLabels(appState, view, { asrRunning, ttsPlaying });
    for (let i = 0; i < 3; i++) {
      presenter.apply({
        mode: "localizedOdom", robot: GO2, view,
        pose: { position: [i, 0, 0], orientation: [0, 0, 0, 1] },
        origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 },
      }, ctx);
      expect(text.text).toBe(label);
      expect(busy.enabled).toBe(label !== "Idle");
      expect(idleVfx.enabled).toBe(label === "Idle");
    }
    presenter.apply({ mode: "unlocalizedFallbackPosition", robot: GO2, view }, ctx);
    // Run the delayed placement callback after the voice-aware label update.
    (presenter as unknown as { commitUnlocalizedAnchor(): void }).commitUnlocalizedAnchor();
    expect(text.text).toBe(label);
    expect(busy.enabled).toBe(label !== "Idle");
  });
});
