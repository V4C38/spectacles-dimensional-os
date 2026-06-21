import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyRegistrationStatusToViewState,
  buildRegistrationDetailText,
  createRegistrationViewState,
  getWizardFooterState,
  hasRegistrationCandidate,
  isRegistrationComplete,
  isRegistrationFailed,
  isRegistrationPendingCommit,
  WizardStep,
} from "../../Assets/Scripts/Setup/SetupRegistrationFlow";
import { RegistrationStatusMessage } from "../../Assets/Scripts/Bridge/Protocol";

function status(
  overrides: Partial<RegistrationStatusMessage>,
): RegistrationStatusMessage {
  return {
    type: "registration_status",
    ts: 1,
    robot_id: "go2",
    mode: "april_odom_baseline",
    phase: "scanning",
    capture: "steady",
    message: "Scanning tag",
    ...overrides,
  };
}

describe("registration flow view state", () => {
  it("maps registration_status directly into view state", () => {
    const next = applyRegistrationStatusToViewState(createRegistrationViewState(), status({
      phase: "awaiting_motion",
      message: "Authorize robot motion",
      tag_visible: true,
      motion: {
        frame: "robot",
        axis: "lateral",
        direction: "left",
        distance_m: 0.5,
        waypoint_index: 1,
        waypoint_total: 2,
      },
    }));
    expect(next.phase).toBe("awaiting_motion");
    expect(next.message).toBe("Authorize robot motion");
    expect(next.tagVisible).toBe(true);
    expect(next.motion?.waypoint_index).toBe(1);
  });

  it("builds detail text from message and motion waypoint", () => {
    const text = buildRegistrationDetailText({
      mode: "auto",
      phase: "moving",
      message: "Robot moving",
      tagVisible: true,
      motion: {
        frame: "robot",
        axis: "lateral",
        direction: "right",
        distance_m: 0.4,
        waypoint_index: 2,
        waypoint_total: 2,
      },
    });
    expect(text).toContain("Robot moving");
    expect(text).toContain("Step 2/2");
  });

  it("footer shows Continue during awaiting_motion", () => {
    const footer = getWizardFooterState(
      WizardStep.Register,
      true,
      {
        mode: "auto",
        phase: "awaiting_motion",
        message: "",
        tagVisible: true,
      },
      false,
    );
    expect(footer.nextLabel).toBe("Continue");
  });

  it("footer shows Complete when awaiting commit", () => {
    expect(hasRegistrationCandidate({
      mode: "auto",
      phase: "awaiting_commit",
      message: "",
      tagVisible: true,
    })).toBe(true);
    const footer = getWizardFooterState(
      WizardStep.Register,
      true,
      {
        mode: "auto",
        phase: "awaiting_commit",
        message: "",
        tagVisible: true,
      },
      false,
    );
    expect(footer.nextLabel).toBe("Complete");
  });

  it("tracks pending commit and terminal phases", () => {
    const state = {
      mode: "auto" as const,
      phase: "awaiting_commit" as const,
      message: "",
      tagVisible: false,
    };
    expect(isRegistrationPendingCommit(state, true)).toBe(true);
    expect(isRegistrationComplete({ ...state, phase: "succeeded" })).toBe(true);
    expect(isRegistrationFailed({ ...state, phase: "failed" })).toBe(true);
  });
});
