import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyRegistrationStatusToViewState,
  buildAlignmentProgressPercent,
  buildAlignmentTitle,
  buildRegistrationDetailText,
  buildRegistrationDisplay,
  createManualRegistrationState,
  createRegistrationViewState,
  formatRegistrationProgressText,
  getWizardFooterState,
  REGISTRATION_STATUS_MANUAL,
  hasRegistrationCandidate,
  isRegistrationComplete,
  isRegistrationFailed,
  isRegistrationPendingCommit,
  RegistrationFlow,
  SCALE_LOCK_WALK_HINT,
  shouldShowBackOnStartStep,
  shouldShowScaleLockHint,
  WizardStep,
} from "../../Assets/Scripts/App/Registration/RegistrationFlow";
import { buildRegistrationPreviewPresentation } from "../../Assets/Scripts/App/Registration/RegistrationWizardView";
import {
  BridgeStatusMessage,
  RegistrationStatusMessage,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";
import { setMockTime } from "../setup/lens-globals";

function status(
  overrides: Partial<RegistrationStatusMessage>,
): RegistrationStatusMessage {
  return {
    type: "registration_status",
    ts: 1,
    mode: "april_tag",
    phase: "scanning",
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
    ensureSession: vi.fn(() => true),
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
      phase: "scanning",
      message: "Look at the AprilTag on your robot",
      tag_visible: true,
      progress: 25,
    }));
    expect(next.phase).toBe("scanning");
    expect(next.message).toBe("Look at the AprilTag on your robot");
    expect(next.tagVisible).toBe(true);
    expect(next.progress).toBe(25);
  });

  it("shows walk-to-lock hint after succeeded when scale is not locked", () => {
    const state = {
      ...createRegistrationViewState(),
      phase: "succeeded" as const,
      scaleLocked: false,
      alignmentConfidence: 0.2,
    };
    expect(shouldShowScaleLockHint(state)).toBe(true);
    const display = buildRegistrationDisplay(state, true);
    expect(display.detailText).toBe(SCALE_LOCK_WALK_HINT);
  });

  it("clears walk-to-lock hint when scale_locked is true", () => {
    const state = {
      ...createRegistrationViewState(),
      phase: "succeeded" as const,
      scaleLocked: true,
      alignmentConfidence: 0.2,
    };
    expect(shouldShowScaleLockHint(state)).toBe(false);
    const display = buildRegistrationDisplay(state, true);
    expect(display.detailText).toBe("");
  });

  it("clears view-state message when bridge sends an empty registration_status message", () => {
    const prior = applyRegistrationStatusToViewState(createRegistrationViewState(), status({
      phase: "scanning",
      message: "Look at the AprilTag on your robot",
      tag_visible: false,
    }));
    const next = applyRegistrationStatusToViewState(prior, status({
      phase: "scanning",
      message: "",
      tag_visible: true,
      progress: 40,
    }));
    expect(next.message).toBe("");
    expect(next.tagVisible).toBe(true);
    expect(next.progress).toBe(40);
  });

  it("builds detail text from message", () => {
    const text = buildRegistrationDetailText({
      mode: "auto",
      phase: "scanning",
      message: "",
      tagVisible: true,
    });
    expect(text).toBe("");
  });

  it("builds alignment title from registration view state", () => {
    expect(
      buildAlignmentTitle({
        mode: "auto",
        phase: "scanning",
        message: "Waiting for camera intrinsics...",
        tagVisible: false,
      }),
    ).toBe("Starting…");
    expect(
      buildAlignmentTitle({
        mode: "auto",
        phase: "scanning",
        message: "",
        tagVisible: true,
        progress: 40,
      }),
    ).toBe("Registration");
    expect(
      buildAlignmentTitle({
        mode: "auto",
        phase: "succeeded",
        message: "",
        tagVisible: true,
      }),
    ).toBe("Registration complete");
  });

  it("uses bridge progress percent from registration view state", () => {
    expect(
      buildAlignmentProgressPercent({
        mode: "auto",
        phase: "scanning",
        message: "",
        tagVisible: true,
        progress: 40,
      }),
    ).toBe(40);
    expect(
      buildAlignmentProgressPercent({
        mode: "auto",
        phase: "scanning",
        message: "",
        tagVisible: true,
        progress: 80,
      }),
    ).toBe(80);
    expect(
      buildAlignmentProgressPercent({
        mode: "auto",
        phase: "succeeded",
        message: "",
        tagVisible: true,
        progress: 100,
      }),
    ).toBe(100);
    expect(
      buildAlignmentProgressPercent({
        mode: "auto",
        phase: "scanning",
        message: "Look at the AprilTag on your robot",
        tagVisible: false,
      }),
    ).toBeNull();
  });

  it("formats registration progress text", () => {
    expect(formatRegistrationProgressText(42)).toBe("42%");
    expect(formatRegistrationProgressText(42.6)).toBe("43%");
  });

  it("builds preview presentation with alignment title and tag visibility", () => {
    const presentation = buildRegistrationPreviewPresentation({
      mode: "auto",
      phase: "scanning",
      message: "",
      tagVisible: true,
      progress: 80,
    });
    expect(presentation.titleText).toBe("Registration");
    expect(presentation.progressPercent).toBe(80);
    expect(presentation.statusText).toBe("✅ Tag detected - move around");
    expect(
      buildRegistrationPreviewPresentation({
        mode: "auto",
        phase: "scanning",
        message: "Look at the AprilTag on your robot",
        tagVisible: false,
      }).statusText,
    ).toBe("❌ Tag not visible");
  });

  it("suppresses wizard detail text when tag is not visible during scanning", () => {
    const display = buildRegistrationDisplay(
      {
        mode: "auto",
        phase: "scanning",
        message: "Look at the AprilTag on your robot",
        tagVisible: false,
      },
      true,
    );
    expect(display.statusText).toBe("❌  Tag not visible");
    expect(display.detailText).toBe("");
  });

  it("hides wizard detail text when tag is visible and bridge message is empty", () => {
    const display = buildRegistrationDisplay(
      {
        mode: "auto",
        phase: "scanning",
        message: "",
        tagVisible: true,
        progress: 40,
      },
      true,
    );
    expect(display.statusText).toBe("✅  Tag detected - move around");
    expect(display.detailText).toBe("");
  });

  it("footer hides Back on step 0 while phase is registration", () => {
    const footer = getWizardFooterState(
      WizardStep.Start,
      false,
      createRegistrationViewState(),
      false,
      shouldShowBackOnStartStep(false),
    );
    expect(footer.showPrev).toBe(false);
    expect(footer.centerNext).toBe(true);
  });

  it("footer shows Back on step 0 when wizard opened from runtime", () => {
    expect(shouldShowBackOnStartStep(true)).toBe(true);
    expect(shouldShowBackOnStartStep(false)).toBe(false);
    const footer = getWizardFooterState(
      WizardStep.Start,
      false,
      createRegistrationViewState(),
      false,
      shouldShowBackOnStartStep(true),
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

  it("10: april_tag auto-commit via registration_status only never sets commitInFlight", () => {
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

describe("RegistrationFlow second registration", () => {
  it("enter always notifies bridge stop before starting auto registration", () => {
    const { flow, registrationClient } = createFlow();
    registrationClient.hasActiveIntent.mockReturnValue(false);
    flow.setState(createRegistrationViewState());
    flow.enter();
    expect(registrationClient.stop).toHaveBeenCalledWith({ notifyBridge: true });
    expect(registrationClient.start).toHaveBeenCalledWith("april_tag");
  });

  it("enter notifies bridge stop when registration client still has active intent", () => {
    const { flow, registrationClient } = createFlow();
    registrationClient.hasActiveIntent.mockReturnValue(true);
    flow.setState(createRegistrationViewState());
    flow.enter();
    expect(registrationClient.stop).toHaveBeenCalledWith({ notifyBridge: true });
    expect(registrationClient.start).toHaveBeenCalledWith("april_tag");
  });

  it("resends bridge session when auto registration progress stalls at 40%", () => {
    setMockTime(200);
    const { flow, registrationClient } = createFlow();
    registrationClient.hasActiveIntent.mockReturnValue(true);
    flow.setState({
      ...createRegistrationViewState(),
      phase: "scanning",
      progress: 40,
    });
    flow.tick();
    setMockTime(200 + 16);
    flow.tick();
    expect(registrationClient.ensureSession).toHaveBeenCalledTimes(1);
  });

  it("does not resend bridge session when auto registration progress stays at 0%", () => {
    setMockTime(200);
    const { flow, registrationClient } = createFlow();
    registrationClient.hasActiveIntent.mockReturnValue(true);
    flow.setState({
      ...createRegistrationViewState(),
      phase: "scanning",
      progress: 0,
    });
    flow.tick();
    setMockTime(200 + 16);
    flow.tick();
    expect(registrationClient.ensureSession).not.toHaveBeenCalled();
  });
});
