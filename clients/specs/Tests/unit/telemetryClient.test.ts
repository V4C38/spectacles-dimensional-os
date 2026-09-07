import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppStateStore } from "../../Assets/Scripts/App/AppState";
import { TelemetryClient } from "../../Assets/Scripts/ARBridge/Telemetry/TelemetryClient";

describe("TelemetryClient world_frame_correction", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).print = vi.fn();
    (globalThis as Record<string, unknown>).getTime = vi.fn(() => 0);
  });

  it("stores similarity solve_method in driftState", () => {
    const appState = new AppStateStore();
    const client = new TelemetryClient(appState, null, null, null);

    client.handleWorldFrameCorrection({
      type: "world_frame_correction",
      ts: 1,
      trans_delta_m: 0.1,
      yaw_delta_deg: 4.5,
      yaw_corrected: true,
      solve_quality: 0.9,
      solve_method: "similarity",
      alignment_confidence: 0.8,
      yaw_observable: true,
      scale_observable: false,
    });

    expect(appState.snapshot.driftState).toMatchObject({
      isDrifting: true,
      transDeltaM: 0.1,
      yawDeltaDeg: 4.5,
      yawCorrected: true,
      solveQuality: 0.9,
      solveMethod: "similarity",
      lastUpdateTs: 1,
    });
  });
});
