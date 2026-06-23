import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyRegistrationStatusToViewState,
  buildRegistrationDetailText,
  buildRegistrationDisplay,
  createManualRegistrationState,
  createRegistrationViewState,
  getWizardFooterState,
  REGISTRATION_STATUS_MANUAL,
  hasRegistrationCandidate,
  isRegistrationComplete,
  isRegistrationFailed,
  isRegistrationPendingCommit,
  SetupRegistrationFlow,
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
    expect(footer.nextInactive).toBe(false);
  });

  it("footer shows inactive Continuing while motion authorization is pending", () => {
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
      true,
    );
    expect(footer.nextLabel).toBe("Continuing...");
    expect(footer.nextInactive).toBe(true);
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
    expect(isRegistrationPendingCommit(state, false)).toBe(false);
    expect(isRegistrationComplete({ ...state, phase: "succeeded" })).toBe(true);
    expect(isRegistrationFailed({ ...state, phase: "failed" })).toBe(true);
  });

  it("shows one manual status line without detail text", () => {
    for (const phase of ["editing", "scanning", "awaiting_commit", "succeeded"] as const) {
      for (const commitInFlight of [false, true]) {
        const display = buildRegistrationDisplay(
          createManualRegistrationState(phase),
          true,
          commitInFlight,
        );
        expect(display.statusText).toBe(REGISTRATION_STATUS_MANUAL);
        expect(display.detailText).toBe("");
      }
    }
  });

  it("completeStep commits manual registration when bridge is awaiting_commit", () => {
    const registrationClient = {
      commit: vi.fn(() => true),
      captureAndSubmitManualPose: vi.fn(() => true),
      freezePlacement: vi.fn(),
      preferredMode: vi.fn(() => "manualOnly" as const),
    };
    const dimosManager = {
      registrationClient,
      bridgeRuntime: { hasConnection: () => true },
    };
    const flow = new SetupRegistrationFlow(dimosManager as any, {
      beginManualRegistrationPlacementFromWizard: () => true,
      render: vi.fn(),
      refreshFooter: vi.fn(),
      refreshDescription: vi.fn(),
      log: vi.fn(),
      finishSetup: vi.fn(),
      scheduleFinishSetup: vi.fn(),
    });
    flow.setState(createManualRegistrationState("awaiting_commit"));

    expect(flow.completeStep()).toBe(false);
    expect(registrationClient.captureAndSubmitManualPose).toHaveBeenCalledWith(true);
    expect(registrationClient.commit).toHaveBeenCalled();
    expect(flow.commitInFlight).toBe(true);
  });
});
