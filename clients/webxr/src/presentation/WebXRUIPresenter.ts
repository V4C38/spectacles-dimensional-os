import { localizationCaptureStatus } from "@dimos-ar-client/localization/localizationCaptureStatus";
import type { LocalizationCaptureEpisode } from "@dimos-ar-client/localization/localizationCaptureEpisode";
import {
  LIDAR_PRESETS,
  lidarModeFromSettings,
  nextLidarMode,
  requestLidarSettings,
  type LidarDisplayMode,
} from "@dimos-ar-client/sensors/lidarSettings";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  sessionLinkStatus,
  sessionLinkTransitionLog,
  type SessionLinkPhase,
  type StatusTone,
} from "@dimos-ar-client/websocket/sessionLinkStatus";
import { requestUserMessage } from "@dimos-ar-client/agent/userMessageRequest";
import { toneHex } from "./tones";

export type OperatingMode = "manual" | "agent";

export type WizardStep = "connect" | "localization";

export interface WebXRUISnapshot {
  wizardStep: WizardStep;
  wizardTitle: string;
  wizardDescription: string;
  wizardCardTitle: string;
  wizardCardBody: string;
  localizationIssue: string | null;
  robotName: string;
  hasTrackingOrigin: boolean;
  nextLabel: string;
  backVisible: boolean;
  debugText: string;
  activity: string;
  setupCompleted: boolean;
  connectionText: string;
  connectionTone: StatusTone;
  captureText: string;
  captureTone: StatusTone;
  operatingMode: OperatingMode;
  lidarMode: LidarDisplayMode;
  lidarAvailable: boolean;
  agentAvailable: boolean;
  estopAvailable: boolean;
  estopReason: string | null;
  agentMessage: string | null;
  hudText: string | null;
  hudTone: StatusTone | null;
  menuOpen: boolean;
}

export class WebXRUIPresenter {
  wizardStep: WizardStep = "connect";
  debugEnabled = false;
  private openedFromRuntime = false;
  private localizationError: string | null = null;
  operatingMode: OperatingMode = "manual";
  lidarMode: LidarDisplayMode = "off";
  setupCompleted = false;
  menuOpen = false;
  private linkPhase: SessionLinkPhase = "disconnected";
  private hudText: string | null = null;
  private hudTone: StatusTone | null = null;
  private hudUntil = 0;
  private wizardLidarOffSent = false;
  private postWizardLidarSent = false;
  private nowS = 0;

  constructor(
    private readonly session: ARModuleSession,
    private readonly episode: LocalizationCaptureEpisode,
    private readonly cameraError: () => string | null = () => null,
  ) {}

  onSessionView(view: ARModuleSessionState, prev: ARModuleSessionState | null, now: number): void {
    if (view.connection !== "ready") {
      this.wizardLidarOffSent = false;
      this.postWizardLidarSent = false;
    }
    const prevPhase = prev ? deriveSessionLinkPhase(prev) : this.linkPhase;
    const nextPhase = deriveSessionLinkPhase(view);
    this.linkPhase = nextPhase;
    const transition = sessionLinkTransitionLog(prevPhase, nextPhase);
    if (transition && this.setupCompleted) {
      this.hudText = transition.hudText;
      this.hudTone = transition.hudColor;
      this.hudUntil = now + (transition.hudDurationS ?? Number.POSITIVE_INFINITY);
    }
    if (view.connection === "ready" && prev?.connection !== "ready" &&
        !this.setupCompleted && this.wizardStep === "localization") this.restartLocalization();
    if (!this.setupCompleted && this.wizardStep === "localization" && view.hasTrackingOrigin && view.connection === "ready") {
      this.completeSetup();
    }
    if (view.state?.lidar) {
      this.lidarMode = lidarModeFromSettings(view.state.lidar);
    }
  }

  tick(now: number): void {
    this.nowS = now;
    if (this.hudText && now >= this.hudUntil) {
      this.hudText = null;
      this.hudTone = null;
    }
    if (!this.setupCompleted) {
      this.ensureWizardLidarOff();
      if (this.wizardStep === "localization" && this.session.view().connection === "ready" &&
          this.session.view().hasTrackingOrigin) this.completeSetup();
      return;
    }
    this.sendPostWizardLidarDefault();
    if (this.operatingMode === "agent" && this.session.view().capabilities?.agent.available !== true) {
      this.operatingMode = "manual";
    }
  }

  snapshot(): WebXRUISnapshot {
    const view = this.session.view();
    const link = sessionLinkStatus(view, view.hello?.robot.display_name);
    const capture = localizationCaptureStatus(view, this.episode.view(), this.nowS);
    const descriptions = {
      connect: "Connect securely to your PC. No PIN required.",
      localization: "Align your headset with the robot using its mounted marker.",
    };
    const issue = this.localizationError ?? this.cameraError();
    const card = this.wizardStep === "connect"
        ? { title: view.connection === "ready" ? "Robot connected" : "Connecting to your robot", body: view.connection === "ready" ? "Ready to align your headset with the robot." : "Waiting for ARModule. Check that the launcher is running, or reconnect to try again." }
        : issue
          ? { title: "Camera alignment unavailable", body: `${issue} You can skip and use the remaining controls.` }
          : { title: capture.text.split("\n")[0] || "Scanning .", body: "Look at the marker. Hold steady until alignment completes." };
    return {
      wizardCardTitle: card.title,
      wizardCardBody: card.body,
      localizationIssue: issue,
      robotName: view.hello?.robot.display_name ?? "Robot control",
      hasTrackingOrigin: view.hasTrackingOrigin,
      wizardStep: this.wizardStep,
      wizardTitle: { connect: "Connect", localization: "Localization" }[this.wizardStep],
      wizardDescription: descriptions[this.wizardStep],
      nextLabel: this.wizardStep === "connect" && view.connection === "ready" ? "Next" : "Skip",
      backVisible: this.wizardStep === "localization" || this.openedFromRuntime,
      debugText: this.debugEnabled ? `Connection: ${view.connection}\nAligned: ${view.hasTrackingOrigin ? "Yes" : "No"}\nCapture: ${capture.text}\n${issue ?? ""}` : "",
      activity: view.nav?.state === "following_path" ? "Following Path" : view.state?.agent.idle === false ? "Thinking" : "Idle",
      setupCompleted: this.setupCompleted,
      connectionText: view.connection === "awaiting_hello" ? "Waiting for handshake…" : view.connection === "failed" ? "Connection lost. Retrying…" : link.text.trim(),
      connectionTone: link.color,
      captureText: this.localizationError ?? capture.text,
      captureTone: issue ? "warn" : capture.color,
      operatingMode: this.operatingMode,
      lidarMode: this.lidarMode,
      lidarAvailable: view.capabilities?.lidar.available === true,
      agentAvailable: view.capabilities?.agent.available === true,
      estopAvailable: view.capabilities?.estop.available === true,
      estopReason: view.capabilities?.estop.reason ?? null,
      agentMessage: view.agentMessage,
      hudText: this.hudText,
      hudTone: this.hudTone,
      menuOpen: this.menuOpen,
    };
  }

  hudColor(): number | null {
    return this.hudTone ? toneHex(this.hudTone) : null;
  }

  completeSetup(): void {
    if (!this.session.view().hasTrackingOrigin) {
      throw new Error("setup requires localization_result");
    }
    this.finishSetup();
  }

  private finishSetup(): void {
    if (!this.session.view().hasTrackingOrigin) this.episode.pause();
    this.setupCompleted = true;
    this.openedFromRuntime = false;
    this.menuOpen = false;
    this.postWizardLidarSent = false;
    this.requestStateIfReady();
    this.sendPostWizardLidarDefault();
  }

  nextSetup(): void {
    if (this.setupCompleted) return;
    if (this.wizardStep === "connect" && this.session.view().connection === "ready") {
      this.wizardStep = "localization";
      if (!this.session.view().hasTrackingOrigin) this.restartLocalization();
    } else {
      if (this.wizardStep === "connect") this.session.stop();
      this.finishSetup();
    }
  }

  previousSetup(): void {
    if (this.setupCompleted) return;
    if (this.wizardStep === "localization") {
      this.episode.pause();
      this.wizardStep = "connect";
    }
    else if (this.openedFromRuntime) this.finishSetup();
  }

  retryConnection(): void {
    this.session.stop();
    this.session.start();
  }

  restartSetup(): void {
    this.openedFromRuntime = this.setupCompleted;
    this.wizardStep = "connect";
    this.localizationError = null;
    this.episode.pause();
    this.setupCompleted = false;
    this.operatingMode = "manual";
    this.lidarMode = "off";
    this.wizardLidarOffSent = false;
    this.postWizardLidarSent = false;
    this.menuOpen = true;
    this.hudText = null;
    this.hudTone = null;
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  setOperatingMode(mode: OperatingMode): void {
    if (mode === "agent" && this.session.view().capabilities?.agent.available !== true) {
      throw new Error("hello.capabilities.agent is not available");
    }
    this.operatingMode = mode;
  }

  cycleLidar(): LidarDisplayMode {
    if (this.session.view().capabilities?.lidar.available !== true) {
      return this.lidarMode;
    }
    this.lidarMode = nextLidarMode(this.lidarMode);
    requestLidarSettings(this.session, LIDAR_PRESETS[this.lidarMode]);
    return this.lidarMode;
  }

  restartLocalization(): void {
    this.localizationError = this.cameraError();
    if (this.localizationError) return;
    try { this.episode.requestStart(); }
    catch (error) { this.localizationError = error instanceof Error ? error.message : String(error); }
  }

  estop(): void {
    if (this.session.view().capabilities?.estop.available !== true) {
      return;
    }
    this.session.requestEstop();
  }

  sendAgentText(text: string): void {
    if (!this.setupCompleted || this.operatingMode !== "agent") throw new Error("Select Agent mode to send a message");
    requestUserMessage(this.session, text);
  }

  private requestStateIfReady(): void {
    if (this.session.view().connection !== "ready") {
      return;
    }
    this.session.requestState();
  }

  private ensureWizardLidarOff(): void {
    if (this.wizardLidarOffSent || this.session.view().connection !== "ready") {
      return;
    }
    try {
      requestLidarSettings(this.session, LIDAR_PRESETS.off);
      this.wizardLidarOffSent = true;
    } catch {
      return;
    }
  }

  private sendPostWizardLidarDefault(): void {
    if (this.postWizardLidarSent || this.session.view().connection !== "ready") {
      return;
    }
    if (this.session.view().capabilities?.lidar.available !== true) {
      return;
    }
    this.lidarMode = "obstacles";
    try {
      requestLidarSettings(this.session, LIDAR_PRESETS.obstacles);
      this.postWizardLidarSent = true;
    } catch {
      return;
    }
  }
}
