import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyRegistrationStatusToViewState,
  buildRegistrationCheckpointTitle,
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
  RegistrationFlow,
  WizardStep,
} from "../../Assets/Scripts/App/Registration/RegistrationFlow";
import {
  BridgeStatusMessage,
  RegistrationStatusMessage,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";

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

function bridgeStatus(
  overrides: Partial<BridgeStatusMessage> = {},
): BridgeStatusMessage {
  return {
    type: "bridge_status",
    ts: 1,
    robot_connected: true,
    world_frame_committed: true,
    reconnecting: false,
    ...overrides,
  };
}

function createFlow(options: {
  mode?: "auto" | "manual";
  hasConnection?: boolean;
  preferredMode?: "auto" | "manualOnly";
  finalizeOffline?: boolean;
} = {}) {
  const finishRegistration = vi.fn();
  const scheduleFinishRegistration = vi.fn();
  const preview = {
    setComplete: vi.fn(),
    begin: vi.fn(),
    end: vi.fn(),
    updateFromRegistrationStatus: vi.fn(),
  };
  const registrationClient = {
    commit: vi.fn(() => true),
    captureAndSubmitManualPose: vi.fn(() => true),
    freezePlacement: vi.fn(),
    cancelPlacement: vi.fn(),
    preferredMode: vi.fn(() => options.preferredMode ?? "auto"),
    stop: vi.fn(),
    clearPose: vi.fn(),
    start: vi.fn(),
    finalizeOffline: vi.fn(() => options.finalizeOffline ?? true),
    hasActiveIntent: vi.fn(() => false),
    isNoResponseTimeout: vi.fn(() => false),
  };
  const coordinator = {
    registrationClient,
    router: { hasConnection: () => options.hasConnection ?? true },
    registrationPreview: preview,
    robot: { applyInteractionFromState: vi.fn() },
    frameCaptureController: { setCaptureErrorHandler: vi.fn() },
  };
  const flow = new RegistrationFlow(coordinator as any, {
    beginManualRegistrationPlacementFromWizard: () => true,
    render: vi.fn(),
    refreshFooter: vi.fn(),
    refreshDescription: vi.fn(),
    log: vi.fn(),
    finishRegistration,
    scheduleFinishRegistration,
  });
  if (options.mode === "manual") {
    flow.setState(createManualRegistrationState("awaiting_commit"));
  } else {
    flow.setState({
      ...createRegistrationViewState(),
      phase: "awaiting_commit",
    });
  }
  return { flow, finishRegistration, scheduleFinishRegistration, preview, registrationClient, coordinator };
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

  it("builds checkpoint title from motion waypoint", () => {
    const motion = {
      frame: "robot" as const,
      axis: "lateral" as const,
      direction: "left" as const,
      distance_m: 0.5,
      waypoint_index: 1,
      waypoint_total: 3,
    };
    expect(buildRegistrationCheckpointTitle(motion, "awaiting_motion")).toBe(
      "\n\n\nCheckpoint 0 / 3",
    );
    expect(buildRegistrationCheckpointTitle(motion, "moving")).toBe("\n\n\nCheckpoint 1 / 3");
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
        waypoint_total: 3,
      },
    });
    expect(text).toBe("Robot moving\n\n\nCheckpoint 2 / 3");
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

  it("footer hides Back on step 0 while phase is registration", () => {
    const footer = getWizardFooterState(
      WizardStep.Start,
      false,
      createRegistrationViewState(),
      false,
      false,
      false,
    );
    expect(footer.showPrev).toBe(false);
    expect(footer.centerNext).toBe(true);
  });

  it("footer shows Back on step 0 while phase is runtime", () => {
    const footer = getWizardFooterState(
      WizardStep.Start,
      false,
      createRegistrationViewState(),
      false,
      false,
      true,
    );
    expect(footer.showPrev).toBe(true);
    expect(footer.centerNext).toBe(false);
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
      finalizeOffline: vi.fn(() => true),
    };
    const coordinator = {
      registrationClient,
      router: { hasConnection: () => true },
    };
    const flow = new RegistrationFlow(coordinator as any, {
      beginManualRegistrationPlacementFromWizard: () => true,
      render: vi.fn(),
      refreshFooter: vi.fn(),
      refreshDescription: vi.fn(),
      log: vi.fn(),
      finishRegistration: vi.fn(),
      scheduleFinishRegistration: vi.fn(),
    });
    flow.setState(createManualRegistrationState("awaiting_commit"));

    expect(flow.completeStep()).toBe(false);
    expect(registrationClient.captureAndSubmitManualPose).toHaveBeenCalledWith(true);
    expect(registrationClient.commit).toHaveBeenCalled();
    expect(flow.commitInFlight).toBe(true);
  });
});

describe("RegistrationFlow commit coordinator", () => {
  it("1: auto registration_status succeeded finishes once via delayed schedule", () => {
    const { flow, finishRegistration, scheduleFinishRegistration } = createFlow();
    flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    expect(flow.state.phase).toBe("succeeded");
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
    expect(scheduleFinishRegistration).toHaveBeenCalledWith(1.5);
    expect(finishRegistration).not.toHaveBeenCalled();
    flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
  });

  it("2: bridge_status committed during commitInFlight completes preview and finishes", () => {
    const { flow, scheduleFinishRegistration, preview } = createFlow();
    flow.completeStep();
    expect(flow.commitInFlight).toBe(true);
    flow.handleBridgeStatus(bridgeStatus());
    expect(flow.state.phase).toBe("succeeded");
    expect(preview.setComplete).toHaveBeenCalledTimes(1);
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
  });

  it("3: both acks in either order dispatch finish once", () => {
    const { flow, scheduleFinishRegistration } = createFlow();
    flow.completeStep();
    flow.handleBridgeStatus(bridgeStatus());
    flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);

    const second = createFlow();
    second.flow.completeStep();
    second.flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    second.flow.handleBridgeStatus(bridgeStatus());
    expect(second.scheduleFinishRegistration).toHaveBeenCalledTimes(1);
  });

  it("4: bridge_status committed without commitInFlight does not complete wizard", () => {
    const { flow, scheduleFinishRegistration, preview } = createFlow();
    flow.handleBridgeStatus(bridgeStatus());
    expect(flow.state.phase).toBe("awaiting_commit");
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
    expect(preview.setComplete).not.toHaveBeenCalled();
  });

  it("5: mode-filtered registration_status plus bridge_status still completes", () => {
    const { flow, scheduleFinishRegistration } = createFlow();
    flow.completeStep();
    flow.handleRegistrationStatus(
      status({ phase: "succeeded", mode: "manual_pose" }),
    );
    expect(flow.state.phase).toBe("awaiting_commit");
    flow.handleBridgeStatus(bridgeStatus());
    expect(flow.state.phase).toBe("succeeded");
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
  });

  it("6: failed registration after commit does not finish registration", () => {
    const { flow, scheduleFinishRegistration } = createFlow();
    flow.completeStep();
    flow.handleRegistrationStatus(status({ phase: "failed", message: "nope" }));
    expect(flow.state.phase).toBe("failed");
    expect(flow.commitInFlight).toBe(false);
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("7: disconnect during commit returns to editing without finish", () => {
    const { flow, scheduleFinishRegistration } = createFlow({ mode: "manual" });
    flow.completeStep();
    flow.handleBridgeConnectionChanged(false);
    expect(flow.state.phase).toBe("editing");
    expect(flow.commitInFlight).toBe(false);
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("8: manual online commit finishes immediately", () => {
    const { flow, finishRegistration, scheduleFinishRegistration } = createFlow({ mode: "manual" });
    flow.handleRegistrationStatus(status({ phase: "succeeded", mode: "manual_pose" }));
    expect(finishRegistration).toHaveBeenCalledTimes(1);
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("9: offline manual finalize does not use bridge handlers", () => {
    const { flow, finishRegistration, scheduleFinishRegistration } = createFlow({
      mode: "manual",
      hasConnection: false,
      finalizeOffline: true,
    });
    flow.setState(createManualRegistrationState("editing"));
    expect(flow.completeStep()).toBe(true);
    expect(finishRegistration).not.toHaveBeenCalled();
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("10: baseline auto-commit via registration_status only never sets commitInFlight", () => {
    const { flow, scheduleFinishRegistration } = createFlow();
    flow.setState(createRegistrationViewState());
    flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    expect(flow.commitInFlight).toBe(false);
    expect(flow.state.phase).toBe("succeeded");
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
  });

  it("11: redo after failure resets finish guard for a second completion", () => {
    const { flow, scheduleFinishRegistration } = createFlow();
    flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
    flow.setState({ ...flow.state, phase: "failed", message: "retry" });
    flow.redo();
    flow.handleRegistrationStatus(status({ phase: "succeeded" }));
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(2);
  });

  it("12: bridge-only ack calls preview setComplete", () => {
    const { flow, preview } = createFlow();
    flow.completeStep();
    flow.handleCommitAcknowledged("bridge_status");
    expect(preview.setComplete).toHaveBeenCalledTimes(1);
  });
});
