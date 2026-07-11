import { describe, it, expect, vi } from "vitest";
import {
  createRegistrationSessionView,
  formatRegistrationProgressText,
  hasRegistrationCandidate,
  isCommitPending,
  isRegistrationComplete,
  isRegistrationFailed,
  mergeRegistrationStatus,
  projectRegistrationPresentation,
  registrationProgressPercent,
  RegistrationFlow,
  RegistrationStep,
  REGISTRATION_STATUS_MANUAL,
  SCALE_LOCK_WALK_HINT,
  shouldShowBackOnStartStep,
  shouldShowScaleLockHint,
} from "../../Assets/Scripts/App/Registration/RegistrationFlow";
import {
  RegistrationStatusMessage,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";

function status(
  overrides: Partial<RegistrationStatusMessage>,
): RegistrationStatusMessage {
  return {
    type: "registration_status",
    ts: 1,
    mode: "april_tag",
    state: "april_tag",
    message: "Scanning tag",
    ...overrides,
  };
}

function createFlow(options: {
  mode?: "april_tag" | "manual_pose";
  hasConnection?: boolean;
  commitManualPlacementOffline?: boolean;
} = {}) {
  const finishRegistration = vi.fn();
  const scheduleFinishRegistration = vi.fn();
  const preview = {
    render: vi.fn(),
    begin: vi.fn(),
    end: vi.fn(),
  };
  const registrationClient = {
    commit: vi.fn(() => true),
    captureAndSubmitManualPose: vi.fn(() => true),
    freezePlacement: vi.fn(),
    cancelPlacement: vi.fn(),
    stop: vi.fn(),
    clearPose: vi.fn(),
    start: vi.fn(),
    commitManualPlacementOffline: vi.fn(() => options.commitManualPlacementOffline ?? true),
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
  if (options.mode === "manual_pose") {
    flow.setSession({
      ...createRegistrationSessionView("manual_pose"),
      state: "awaiting_commit",
    });
  } else {
    flow.setSession({
      ...createRegistrationSessionView("april_tag"),
      state: "awaiting_commit",
    });
  }
  return { flow, finishRegistration, scheduleFinishRegistration, preview, registrationClient, coordinator };
}

describe("registration presentation", () => {
  it("maps registration_status into session view", () => {
    const next = mergeRegistrationStatus(createRegistrationSessionView(), status({
      state: "april_tag",
      message: "Look at the AprilTag on your robot",
      tag_visible: true,
      progress: 25,
      registration_confidence: 0.4,
    }));
    expect(next.state).toBe("april_tag");
    expect(next.statusDetail).toBe("Look at the AprilTag on your robot");
    expect(next.tagVisible).toBe(true);
    expect(next.progress).toBe(25);
    expect(next.registrationConfidence).toBe(0.4);
  });

  it("shows walk-to-lock hint after succeeded when scale is not locked", () => {
    const session = {
      ...createRegistrationSessionView("april_tag"),
      state: "succeeded" as const,
      scaleLocked: false,
      registrationConfidence: 0.2,
    };
    expect(shouldShowScaleLockHint(session)).toBe(true);
    const presentation = projectRegistrationPresentation(session, {
      step: "registerRobot",
      connected: true,
    });
    expect(presentation.panelDetailText).toBe(SCALE_LOCK_WALK_HINT);
  });

  it("projects april_tag panel status from tag visibility", () => {
    const presentation = projectRegistrationPresentation(
      {
        ...createRegistrationSessionView("april_tag"),
        state: "april_tag",
        tagVisible: false,
        statusDetail: "Look at the AprilTag on your robot",
      },
      { step: "registerRobot", connected: true },
    );
    expect(presentation.panelStatusText).toBe("❌  Tag not visible");
    expect(presentation.panelDetailText).toBe("");
  });

  it("hides tag visibility status during the confidence tail", () => {
    const presentation = projectRegistrationPresentation(
      {
        ...createRegistrationSessionView("april_tag"),
        state: "april_tag",
        tagVisible: false,
        progress: 85,
        statusDetail: "Look at the AprilTag on your robot",
      },
      { step: "registerRobot", connected: true },
    );
    expect(presentation.panelStatusText).toBe("");
    expect(presentation.overlayStatus).toBe("");
  });

  it("projects manual mode panel status", () => {
    const presentation = projectRegistrationPresentation(
      createRegistrationSessionView("manual_pose"),
      { step: "registerRobot", connected: true },
    );
    expect(presentation.panelStatusText).toBe(REGISTRATION_STATUS_MANUAL);
  });

  it("tracks pending commit from state", () => {
    expect(isCommitPending("awaiting_commit")).toBe(true);
    expect(isCommitPending("april_tag")).toBe(false);
    expect(hasRegistrationCandidate("awaiting_commit")).toBe(true);
    expect(isRegistrationComplete("succeeded")).toBe(true);
    expect(isRegistrationFailed("failed")).toBe(true);
  });

  it("formats registration progress text", () => {
    expect(formatRegistrationProgressText(42)).toBe("42%");
    expect(formatRegistrationProgressText(42.6)).toBe("43%");
  });

  it("derives progress percent from session", () => {
    expect(
      registrationProgressPercent({
        ...createRegistrationSessionView(),
        progress: 40,
      }),
    ).toBe(40);
    expect(
      registrationProgressPercent({
        ...createRegistrationSessionView(),
        state: "succeeded",
      }),
    ).toBe(100);
  });

  it("footer hides Back on step 0 while phase is registration", () => {
    const presentation = projectRegistrationPresentation(createRegistrationSessionView(), {
      step: "startRobot",
      connected: false,
      canGoBackAtStart: false,
    });
    expect(presentation.footerShowPrev).toBe(false);
  });

  it("footer shows Back on step 0 when wizard opened from runtime", () => {
    expect(shouldShowBackOnStartStep(true)).toBe(true);
    const presentation = projectRegistrationPresentation(createRegistrationSessionView(), {
      step: "startRobot",
      connected: false,
      canGoBackAtStart: true,
    });
    expect(presentation.footerShowPrev).toBe(true);
  });
});

describe("RegistrationFlow", () => {
  it("auto registration_status succeeded finishes once via delayed schedule", () => {
    const { flow, finishRegistration, scheduleFinishRegistration } = createFlow();
    flow.handleRegistrationStatus(status({ state: "succeeded" }));
    expect(flow.session.state).toBe("succeeded");
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
    expect(scheduleFinishRegistration).toHaveBeenCalledWith(1.5);
    expect(finishRegistration).not.toHaveBeenCalled();
    flow.handleRegistrationStatus(status({ state: "succeeded" }));
    expect(scheduleFinishRegistration).toHaveBeenCalledTimes(1);
  });

  it("failed registration after commit does not finish registration", () => {
    const { flow, scheduleFinishRegistration } = createFlow();
    flow.completeRegistration();
    flow.handleRegistrationStatus(status({ state: "failed", message: "nope" }));
    expect(flow.session.state).toBe("failed");
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("disconnect during commit returns to manual_placement without finish", () => {
    const { flow, scheduleFinishRegistration } = createFlow({ mode: "manual_pose" });
    flow.completeRegistration();
    flow.handleBridgeConnectionChanged(false);
    expect(flow.session.state).toBe("manual_placement");
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("manual online commit finishes immediately", () => {
    const { flow, finishRegistration, scheduleFinishRegistration } = createFlow({
      mode: "manual_pose",
    });
    flow.handleRegistrationStatus(status({ state: "succeeded", mode: "manual_pose" }));
    expect(finishRegistration).toHaveBeenCalledTimes(1);
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("offline manual finalize does not use bridge handlers", () => {
    const { flow, finishRegistration, scheduleFinishRegistration } = createFlow({
      mode: "manual_pose",
      hasConnection: false,
      commitManualPlacementOffline: true,
    });
    flow.setSession(createRegistrationSessionView("manual_pose"));
    expect(flow.completeRegistration()).toBe(true);
    expect(finishRegistration).not.toHaveBeenCalled();
    expect(scheduleFinishRegistration).not.toHaveBeenCalled();
  });

  it("enter starts april_tag when bridge is connected", () => {
    const { flow, registrationClient } = createFlow();
    flow.setSession(createRegistrationSessionView());
    flow.enter();
    expect(registrationClient.stop).toHaveBeenCalledWith({ notifyBridge: true });
    expect(registrationClient.start).toHaveBeenCalledWith("april_tag");
  });

  it("enter starts manual_pose when bridge is disconnected", () => {
    const { flow, registrationClient } = createFlow({ hasConnection: false });
    flow.enter();
    expect(registrationClient.start).toHaveBeenCalledWith("manual_pose");
  });

  it("completeRegistration commits manual registration when bridge is awaiting_commit", () => {
    const registrationClient = {
      commit: vi.fn(() => true),
      captureAndSubmitManualPose: vi.fn(() => true),
      freezePlacement: vi.fn(),
      stop: vi.fn(),
      clearPose: vi.fn(),
      start: vi.fn(),
      commitManualPlacementOffline: vi.fn(() => true),
    };
    const coordinator = {
      registrationClient,
      router: { hasConnection: () => true },
      registrationPreview: { render: vi.fn(), begin: vi.fn(), end: vi.fn() },
      robot: { applyInteractionFromState: vi.fn() },
      frameCaptureController: { setCaptureErrorHandler: vi.fn() },
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
    flow.setSession({
      ...createRegistrationSessionView("manual_pose"),
      state: "manual_placement",
    });

    expect(flow.completeRegistration()).toBe(false);
    expect(registrationClient.captureAndSubmitManualPose).toHaveBeenCalledWith(true);
    expect(registrationClient.commit).toHaveBeenCalled();
    expect(flow.session.state).toBe("awaiting_commit");
  });
});
