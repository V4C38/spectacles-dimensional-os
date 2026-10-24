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
import { toneHex } from "./StatusTones";

export type OperatingMode = "manual" | "agent";

export type WizardStep = "connect" | "localization";

export interface WebXRUISnapshot {
  wizardStep: WizardStep;
  connectComplete?: boolean;
  localizationKind?: "marker" | "vps" | "mixed" | "unknown" | "unavailable";
  setupCelebrating?: boolean;
  setupSuccessProgress?: number;
  wizardTitle: string;
  wizardDescription: string;
  wizardCardTitle: string;
  wizardCardBody: string;
  localizationIssue: string | null;
  robotName: string;
  robotSelected: boolean;
  robotConnectionText: string;
  robotSelectable: boolean;
  debugEnabled: boolean;
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
  private lastRobotName = "Robot";
  private successElapsedS: number | null = null;
  private lastVisibleTickAt: number | null = null;

  constructor(
    private readonly session: ARModuleSession,
    private readonly episode: LocalizationCaptureEpisode,
    private readonly cameraError: () => string | null = () => null,
    private readonly isRobotSelected: () => boolean = () => false,
  ) {}

  onSessionView(view: ARModuleSessionState, prev: ARModuleSessionState | null, now: number): void {
    this.nowS = now;
    if (view.connection !== "ready") {
      this.successElapsedS = null;
      this.wizardLidarOffSent = false;
      this.postWizardLidarSent = false;
    }
    if (view.hello) this.lastRobotName = view.hello.robot.display_name;
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
    const visibleDeltaS = this.lastVisibleTickAt === null ? 0 : Math.min(0.1, Math.max(0, now - this.lastVisibleTickAt));
    this.lastVisibleTickAt = now;
    if (this.successElapsedS !== null) this.successElapsedS += visibleDeltaS;
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
    const policy = this.episode.view().capturePolicy;
    const kind = view.capabilities?.localization.available !== true ? "unavailable" :
      policy === "robot_los_required" ? "marker" : policy === "any_angle" ? "vps" :
        policy === "robot_los_preferred" ? "mixed" : "unknown";
    const descriptions = {
      connect: "",
      localization: kind === "vps" ? "VPS" :
        kind === "mixed" ? "AprilTag + VPS" :
          kind === "marker" ? "AprilTag" :
            kind === "unavailable" ? "No localization provider" : "Waiting for localization…",
    };
    const issue = kind === "unavailable" ? null : this.localizationError ?? this.cameraError();
    const guidance = kind === "vps" ? "Look around the mapped space." :
      kind === "mixed" ? "Frame the tag, or look around the mapped space." :
        kind === "marker" ? "Frame the tag at the guide’s approximate size." :
          kind === "unavailable" ? "Skip to continue without localization." : "Waiting for camera…";
    const card = this.wizardStep === "connect"
      ? { title: view.connection === "ready" ? "Connected to dimOS ARModule" : "Connecting", body: view.connection === "ready" ? `WebSocket connected\nRobot: ${view.hello?.robot.display_name ?? "Unavailable"}\n${availableFeatures(view.capabilities)}` : "Waiting for the launcher." }
      : issue ? { title: "Camera unavailable", body: issue }
        : { title: kind === "unavailable" ? "Localization unavailable" : capture.text.split("\n")[0] || "Preparing camera…", body: guidance };
    return {
      connectComplete: view.connection === "ready",
      localizationKind: kind,
      setupCelebrating: this.successElapsedS !== null && this.successElapsedS < 1.5,
      setupSuccessProgress: this.successElapsedS === null ? 0 : Math.min(1, this.successElapsedS / 0.65),
      wizardCardTitle: card.title,
      wizardCardBody: card.body,
      localizationIssue: issue,
      robotName: view.hello?.robot.display_name ?? this.lastRobotName,
      robotSelected: this.isRobotSelected(),
      robotConnectionText: { disconnected: "Disconnected", connecting: "Connecting…", robotOffline: "Robot offline", connected: "Connected" }[deriveSessionLinkPhase(view)],
      robotSelectable: this.setupCompleted && view.connection === "ready",
      debugEnabled: this.debugEnabled,
      hasTrackingOrigin: view.hasTrackingOrigin,
      wizardStep: this.wizardStep,
      wizardTitle: { connect: "Connect", localization: "Localization" }[this.wizardStep],
      wizardDescription: descriptions[this.wizardStep],
      nextLabel: this.wizardStep === "connect" && view.connection === "ready" ? "Continue" : "Skip",
      backVisible: this.wizardStep === "localization" || this.openedFromRuntime,
      debugText: `Connection: ${view.connection}\nAligned: ${view.hasTrackingOrigin ? "Yes" : "No"}\nCapture: ${capture.text}\n${issue ?? ""}`,
      activity: view.nav?.state === "following_path" ? "Following Path" : view.state?.agent.idle === false ? "Thinking" : "Idle",
      setupCompleted: this.setupCompleted,
      connectionText: view.connection === "awaiting_hello" ? "Connecting…" : view.connection === "failed" ? "Reconnecting…" : link.text.trim(),
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
    this.finishSetup(true);
  }

  private finishSetup(success = false): void {
    if (!this.session.view().hasTrackingOrigin) this.episode.pause();
    this.setupCompleted = true;
    this.successElapsedS = success ? 0 : null;
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
    this.successElapsedS = null;
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
    if (this.session.view().capabilities?.localization.available !== true) return;
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
    if (!this.isRobotSelected()) throw new Error("Select the robot to send a message");
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

/** One concise capability vocabulary for setup and the landing information panel. */
export function availableFeatures(capabilities: ARModuleSessionState["capabilities"]): string {
  const labels = { navigation: "Navigation", agent: "Agent", lidar: "LiDAR", localization: "Localization", estop: "Emergency Stop" } as const;
  const features = (Object.keys(labels) as (keyof typeof labels)[]).filter(key => capabilities?.[key]?.available).map(key => labels[key]);
  return features.length ? `Available: ${features.join(", ")}` : "No features available";
}
