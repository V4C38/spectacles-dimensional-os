// ================================================================
/** Agent-mode ASR lifecycle: wake word, session, e-stop, bridge relay, UI lines 7/8. */
// ================================================================

import { AgentClient } from "../../ARBridge/Agent/AgentClient";
import {
  AgentResponseMessage,
  AgentStatusMessage,
} from "../../ARBridge/Network/Protocol";
import { AppStateStore } from "../AppState";
import { isCapabilityAvailable } from "../Robot/RobotRuntimeModel";
import { NavigationController } from "../Navigation/NavigationController";
import { COLOR_WARN } from "../UI/UIKit";
import { UILogger } from "../UI/UILogger";
import {
  AGENT_SESSION_IDLE_TIMEOUT_S,
  closeAgentSpeechSession,
  createAgentSpeechSessionState,
  deriveAgentPromptEntry,
  isAgentSpeechSessionExpired,
  reduceFinalTranscript,
  StopCommandMatcher,
  type AgentSpeechSessionState,
} from "./AgentSpeechSession";

const WAKE_SILENCE_MS = 1500;
const CONVO_SILENCE_MS = 2000;
const MAX_ASR_ERROR_RETRIES = 3;
const ASR_ERROR_RETRY_DELAY_SEC = 0.5;

const BRIDGE_NOT_READY_RESPONSE = "command not sent (bridge not ready)";
const ESTOP_NOT_SENT_RESPONSE = "emergency stop not sent (bridge not ready)";

export interface AgentSpeechControllerDeps {
  eventHost: BaseScriptComponent;
  asrModule: AsrModule;
  agentClient: AgentClient;
  navigation: NavigationController;
  appStateStore: AppStateStore;
  uiLogger: UILogger;
  getBridgeSessionReady: () => boolean;
}

export class AgentSpeechController {
  private readonly _stopMatcher = new StopCommandMatcher();
  private _session: AgentSpeechSessionState = createAgentSpeechSessionState();
  private _asrOptions: AsrModule.AsrTranscriptionOptions | null = null;
  private _asrActive = false;
  private _asrErrorCount = 0;
  private _shouldRun = false;
  private _latestAgentResponseText: string | null = null;
  private _bound = false;
  private _unsubscribeAppState: (() => void) | null = null;

  constructor(private readonly _deps: AgentSpeechControllerDeps) {}

  public bind(): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._initAsrOptions();

    this._deps.agentClient.onAgentStatus.add((msg) => this._onAgentStatus(msg));
    this._deps.agentClient.onAgentResponse.add((msg) => this._onAgentResponse(msg));

    this._unsubscribeAppState = this._deps.appStateStore.subscribe((state) => {
      const shouldRun = state.phase === "runtime" && state.operatingMode === "agent";
      if (shouldRun === this._shouldRun) {
        return;
      }
      this._shouldRun = shouldRun;
      if (shouldRun) {
        this._startAsr();
        return;
      }
      this._stopAgentMode();
    });

    this._deps.eventHost.createEvent("UpdateEvent").bind(() => {
      this._tickSessionExpiry();
    });
  }

  private _initAsrOptions(): void {
    if (this._asrOptions) {
      return;
    }
    const options = AsrModule.AsrTranscriptionOptions.create();
    options.mode = AsrModule.AsrMode.HighAccuracy;
    options.onTranscriptionUpdateEvent.add((eventArgs) => {
      this._onTranscriptionUpdate(eventArgs);
    });
    options.onTranscriptionErrorEvent.add((errorCode) => {
      this._onTranscriptionError(errorCode);
    });
    this._asrOptions = options;
  }

  private _startAsr(): void {
    this._initAsrOptions();
    const silenceMs = this._session.active ? CONVO_SILENCE_MS : WAKE_SILENCE_MS;
    this._asrOptions!.silenceUntilTerminationMs = silenceMs;

    if (this._asrActive) {
      this._deps.asrModule.stopTranscribing().then(() => this._beginTranscribing());
      return;
    }
    this._beginTranscribing();
  }

  private _beginTranscribing(): void {
    if (!this._shouldRun || !this._asrOptions) {
      return;
    }
    this._deps.asrModule.startTranscribing(this._asrOptions);
    this._asrActive = true;
    print("AgentSpeechController: ASR started");
  }

  private _stopAsr(): void {
    if (!this._asrActive) {
      return;
    }
    this._asrActive = false;
    this._deps.asrModule.stopTranscribing();
    print("AgentSpeechController: ASR stopped");
  }

  private _stopAgentMode(): void {
    this._stopAsr();
    this._session = closeAgentSpeechSession(this._session);
    this._stopMatcher.reset();
    this._asrErrorCount = 0;
    this._latestAgentResponseText = null;
    this._deps.appStateStore.update({ agentSpeechSessionActive: false });
    this._deps.uiLogger.setAgentPrompt(null);
    this._deps.uiLogger.setAgentResponse(null);
  }

  private _onTranscriptionUpdate(eventArgs: AsrModule.TranscriptionUpdateEvent): void {
    if (!this._shouldRun) {
      return;
    }

    const text = eventArgs.text;
    const isFinal = eventArgs.isFinal;

    print(
      `AgentSpeechController: ${isFinal ? `ASR final: ${text}` : `ASR: ${text}`}`,
    );

    if (this._stopMatcher.check(text, isFinal)) {
      this._handleStopCommand();
    }

    const promptEntry = deriveAgentPromptEntry(this._session, text);
    if (promptEntry) {
      this._deps.uiLogger.setAgentPrompt(promptEntry);
    }

    if (!isFinal) {
      return;
    }

    const now = getTime();
    const { state, action } = reduceFinalTranscript(this._session, text, now);
    this._session = state;

    if (action.kind === "wake_only") {
      this._deps.appStateStore.update({ agentSpeechSessionActive: true });
      this._restartAsrForSilenceWindow();
      return;
    }

    if (action.kind === "send") {
      this._deps.appStateStore.update({ agentSpeechSessionActive: true });
      const sent = this._deps.agentClient.sendAgentCommand(action.text);
      if (!sent) {
        this._deps.uiLogger.setAgentResponse({
          text: BRIDGE_NOT_READY_RESPONSE,
          state: "idle",
          warn: true,
        });
      }
      this._restartAsrForSilenceWindow();
    }
  }

  private _handleStopCommand(): void {
    const runtime = this._deps.appStateStore.snapshot.robotRuntime;
    const estopAvailable = isCapabilityAvailable(runtime, "emergency_stop");
    this._deps.navigation.requestEmergencyStop();
    if (!estopAvailable || !this._deps.getBridgeSessionReady()) {
      this._deps.uiLogger.setAgentResponse({
        text: ESTOP_NOT_SENT_RESPONSE,
        state: "idle",
        warn: true,
      });
    }
  }

  private _onTranscriptionError(errorCode: AsrModule.AsrStatusCode): void {
    this._asrErrorCount += 1;
    const message = `ASR error: ${errorCode}`;
    print(`AgentSpeechController: ${message}`);
    this._deps.uiLogger.logConsole(message, COLOR_WARN);

    if (this._asrActive) {
      this._stopAsr();
    }

    if (
      errorCode === AsrModule.AsrStatusCode.Unauthenticated
      || errorCode === AsrModule.AsrStatusCode.NoInternet
    ) {
      print("AgentSpeechController: ASR not restarted (connectivity/auth error)");
      return;
    }

    if (this._asrErrorCount > MAX_ASR_ERROR_RETRIES || !this._shouldRun) {
      print("AgentSpeechController: ASR error limit reached, not restarting");
      return;
    }

    const retryEvent = this._deps.eventHost.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    retryEvent.reset(ASR_ERROR_RETRY_DELAY_SEC);
    retryEvent.bind(() => {
      if (this._shouldRun) {
        this._startAsr();
      }
    });
  }

  private _restartAsrForSilenceWindow(): void {
    if (!this._shouldRun) {
      return;
    }
    this._startAsr();
  }

  private _tickSessionExpiry(): void {
    if (!this._session.active) {
      return;
    }
    const now = getTime();
    if (!isAgentSpeechSessionExpired(this._session, now, AGENT_SESSION_IDLE_TIMEOUT_S)) {
      return;
    }
    this._session = closeAgentSpeechSession(this._session);
    this._deps.appStateStore.update({ agentSpeechSessionActive: false });
    this._restartAsrForSilenceWindow();
  }

  private _onAgentStatus(msg: AgentStatusMessage): void {
    this._deps.appStateStore.update({
      agentActivity: {
        state: msg.state,
        detail: msg.detail ?? null,
      },
    });
    if (this._latestAgentResponseText) {
      this._deps.uiLogger.setAgentResponse({
        text: this._latestAgentResponseText,
        state: msg.state,
      });
    }
  }

  private _onAgentResponse(msg: AgentResponseMessage): void {
    this._latestAgentResponseText = msg.text;
    const agentState = this._deps.appStateStore.snapshot.agentActivity.state;
    this._deps.uiLogger.setAgentResponse({
      text: msg.text,
      state: agentState,
    });
  }
}
