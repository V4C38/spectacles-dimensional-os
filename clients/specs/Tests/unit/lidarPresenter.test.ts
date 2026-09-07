import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultRobotRuntimeState } from "../../Assets/Scripts/App/AppState";
import {
  LidarPresenter,
  LidarRenderContext,
} from "../../Assets/Scripts/App/Lidar/LidarPresenter";
import {
  LIDAR_FULL_POINT_CAP,
  LIDAR_OBSTACLE_POINT_CAP,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";
import { setMockTime } from "../setup/lens-globals";

type MockRenderer = {
  renderPointCloud: ReturnType<typeof vi.fn>;
  renderMockLidar: ReturnType<typeof vi.fn>;
  setFullLidarVisible: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
  clearFullLidar: ReturnType<typeof vi.fn>;
  clearObstacleLidar: ReturnType<typeof vi.fn>;
  setRobotWorldPosition: ReturnType<typeof vi.fn>;
  setRobotFloorWorldY: ReturnType<typeof vi.fn>;
  setLidarVerticalBand: ReturnType<typeof vi.fn>;
  setObstacleDistanceBand: ReturnType<typeof vi.fn>;
};

function createMockRenderer(): MockRenderer {
  return {
    renderPointCloud: vi.fn(),
    renderMockLidar: vi.fn(),
    setFullLidarVisible: vi.fn(),
    clearAll: vi.fn(),
    clearFullLidar: vi.fn(),
    clearObstacleLidar: vi.fn(),
    setRobotWorldPosition: vi.fn(),
    setRobotFloorWorldY: vi.fn(),
    setLidarVerticalBand: vi.fn(),
    setObstacleDistanceBand: vi.fn(),
  };
}

function liveContext(
  patch: Partial<LidarRenderContext> = {},
): LidarRenderContext {
  return {
    mode: "obstacles",
    active: true,
    connected: true,
    anchor: new vec3(10, 0, 20),
    runtime: createDefaultRobotRuntimeState(),
    ...patch,
  };
}

describe("LiDAR point caps", () => {
  it("exports paired operational budgets", () => {
    expect(LIDAR_FULL_POINT_CAP).toBe(1500);
    expect(LIDAR_OBSTACLE_POINT_CAP).toBe(200);
  });
});

describe("LidarPresenter packet-locked rendering", () => {
  let renderer: MockRenderer;
  let presenter: LidarPresenter;

  beforeEach(() => {
    setMockTime(0);
    renderer = createMockRenderer();
    presenter = new LidarPresenter(renderer as unknown as never);
  });

  it("renders one active layer when a packet arrives", () => {
    const points: [number, number, number][] = [[1, 0, 2]];
    presenter.onLidarReceived(points, liveContext({ mode: "obstacles" }));

    expect(renderer.renderPointCloud).toHaveBeenCalledTimes(1);
    expect(renderer.renderPointCloud).toHaveBeenCalledWith(points, "obstacles");
    expect(renderer.setFullLidarVisible).toHaveBeenCalledWith(false);
  });

  it("does not rebuild when presentation state is unchanged and connected", () => {
    presenter.onPresentationStateChanged(liveContext({ mode: "obstacles" }));
    presenter.onPresentationStateChanged(liveContext({ mode: "obstacles" }));

    expect(renderer.renderPointCloud).not.toHaveBeenCalled();
    expect(renderer.renderMockLidar).not.toHaveBeenCalled();
  });

  it("clears the inactive layer once on mode change without rebuilding stale data", () => {
    presenter.onPresentationStateChanged(liveContext({ mode: "obstacles" }));
    presenter.onPresentationStateChanged(liveContext({ mode: "full" }));

    expect(renderer.clearObstacleLidar).toHaveBeenCalledTimes(1);
    expect(renderer.renderPointCloud).not.toHaveBeenCalled();
    expect(renderer.setFullLidarVisible).toHaveBeenCalledWith(true);
  });

  it("clears all LiDAR visuals after stale timeout", () => {
    setMockTime(1);
    presenter.onLidarReceived([[0, 0, 0]], liveContext());
    setMockTime(5);
    presenter.tickFrame(true, "obstacles", true, 3);

    expect(renderer.clearAll).toHaveBeenCalledTimes(1);
  });

  it("clears everything when LiDAR is turned off", () => {
    presenter.onPresentationStateChanged(liveContext({ mode: "off" }));

    expect(renderer.clearAll).toHaveBeenCalledTimes(1);
  });
});
