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

export interface WebXRUISnapshot {
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

  constructor(
    private readonly session: ARModuleSession,
    private readonly episode: LocalizationCaptureEpisode,
  ) {}

  onSessionView(view: ARModuleSessionState, prev: ARModuleSessionState | null, now: number): void {
    const prevPhase = prev ? deriveSessionLinkPhase(prev) : this.linkPhase;
    const nextPhase = deriveSessionLinkPhase(view);
    this.linkPhase = nextPhase;
    const transition = sessionLinkTransitionLog(prevPhase, nextPhase);
    if (transition && this.setupCompleted) {
      this.hudText = transition.hudText;
      this.hudTone = transition.hudColor;
      this.hudUntil = now + (transition.hudDurationS ?? Number.POSITIVE_INFINITY);
    }
    if (view.state?.lidar) {
      this.lidarMode = lidarModeFromSettings(view.state.lidar);
    }
  }

  tick(now: number): void {
    if (this.hudText && now >= this.hudUntil) {
      this.hudText = null;
      this.hudTone = null;
    }
    if (!this.setupCompleted) {
      this.ensureWizardLidarOff();
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
    const capture = localizationCaptureStatus(view, this.episode.view());
    return {
      setupCompleted: this.setupCompleted,
      connectionText: link.text.trim(),
      connectionTone: link.color,
      captureText: capture.text,
      captureTone: capture.color,
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
    this.setupCompleted = true;
    this.postWizardLidarSent = false;
    this.requestStateIfReady();
    this.sendPostWizardLidarDefault();
  }

  restartSetup(): void {
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
    this.episode.requestStart();
  }

  estop(): void {
    if (this.session.view().capabilities?.estop.available !== true) {
      return;
    }
    this.session.requestEstop();
  }

  sendAgentText(text: string): void {
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
