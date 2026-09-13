import { sendHumanInput } from "../../DimOSARClient/agent/humanInput";
import type { ARModuleSession, ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import { COLOR_ERROR, COLOR_WARN } from "../presentation/UIKit";
import { UILogger } from "../presentation/UILogger";
import { classifyAgentResponseText } from "./AgentResponseClassification";
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
import type { SpecsTextToSpeech } from "../presentation/SpecsTextToSpeech";
import type { OperatingMode } from "../presentation/MainMenuView";
import { agentSpeechShouldRun } from "../presentation/AppState";

const WAKE_SILENCE_MS = 3000;
const CONVO_SILENCE_MS = 2000;
const MAX_ASR_ERROR_RETRIES = 3;
const ASR_ERROR_RETRY_DELAY_SEC = 0.5;

export interface AgentSpeechControllerDeps {
  eventHost: BaseScriptComponent;
  asrModule: AsrModule;
  session: ARModuleSession;
  uiLogger: UILogger;
  tts: SpecsTextToSpeech;
  getOperatingMode: () => OperatingMode;
  getDebugMode: () => boolean;
}

export class AgentSpeechController {
  private readonly _stopMatcher = new StopCommandMatcher();
  private _session: AgentSpeechSessionState = createAgentSpeechSessionState();
  private _asrOptions: AsrModule.AsrTranscriptionOptions | null = null;
  private _asrActive = false;
  private _asrErrorCount = 0;
  private _shouldRun = false;
  private _latestAgentResponseText: string | null = null;
  private _lastIdle = true;
  private _bound = false;
  private _unsubscribeView: (() => void) | null = null;

  constructor(private readonly _deps: AgentSpeechControllerDeps) {}

  public get asrRunning(): boolean {
    return this._asrActive;
  }

  public bind(): void {
    if (this._bound) {
      return;
    }
    this._bound = true;
    this._initAsrOptions();
    this._deps.tts.onError((message) => {
      this._deps.uiLogger.setAgentResponse({
        text: message,
        state: "idle",
        severity: "error",
      });
    });
    this._unsubscribeView = this._deps.session.subscribeView((view) => this._onSessionView(view));
    this.syncEnabled();
  }

  public dispose(): void {
    this._unsubscribeView?.();
    this._unsubscribeView = null;
    this._shouldRun = false;
    this._stopAgentMode();
    this._bound = false;
  }

  public tick(): void {
    this._tickSessionExpiry();
    this._deps.tts.tick();
  }

  public syncEnabled(): void {
    const view = this._deps.session.view();
    const shouldRun = agentSpeechShouldRun(
      this._deps.getOperatingMode(),
      this._deps.getDebugMode(),
      view.connection === "ready",
      view.capabilities?.agent.available === true,
    );
    if (shouldRun === this._shouldRun) {
      return;
    }
    this._shouldRun = shouldRun;
    if (shouldRun) {
      this._startAsr();
      return;
    }
    this._stopAgentMode();
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
    this._lastIdle = true;
    this._deps.tts.stop();
    this._deps.uiLogger.setAgentPrompt(null);
    this._deps.uiLogger.setAgentResponse(null);
  }

  private _onTranscriptionUpdate(eventArgs: AsrModule.TranscriptionUpdateEvent): void {
    if (!this._shouldRun) {
      return;
    }

    const text = eventArgs.text;
    const isFinal = eventArgs.isFinal;

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
      this._restartAsrForSilenceWindow();
      return;
    }

    if (action.kind === "send") {
      if (this._canSendHumanInput()) {
        try {
          sendHumanInput(this._deps.session, action.text);
        } catch {
          print("AgentSpeechController: human_input not sent");
        }
      }
      this._restartAsrForSilenceWindow();
    }
  }

  private _canSendHumanInput(): boolean {
    const view = this._deps.session.view();
    return view.connection === "ready" && view.capabilities?.agent.available === true;
  }

  private _handleStopCommand(): void {
    if (this._deps.session.view().connection !== "ready") {
      return;
    }
    try {
      this._deps.session.requestEstop();
    } catch {
      print("AgentSpeechController: estop not sent");
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
      errorCode === AsrModule.AsrStatusCode.Unauthenticated ||
      errorCode === AsrModule.AsrStatusCode.NoInternet
    ) {
      const asrUserMessage =
        errorCode === AsrModule.AsrStatusCode.Unauthenticated
          ? "Speech recognition unavailable (not authenticated)"
          : "Speech recognition unavailable (no internet)";
      this._deps.uiLogger.setAgentResponse({
        text: asrUserMessage,
        state: "idle",
        severity: "error",
      });
      this._deps.uiLogger.show(asrUserMessage, COLOR_ERROR, 3.0);
      return;
    }

    if (this._asrErrorCount > MAX_ASR_ERROR_RETRIES || !this._shouldRun) {
      return;
    }

    const retryEvent = this._deps.eventHost.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
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
    this._restartAsrForSilenceWindow();
  }

  private _onSessionView(view: ARModuleSessionState): void {
    this.syncEnabled();
    if (!this._shouldRun) {
      return;
    }
    if (view.connection !== "ready") {
      this._deps.uiLogger.setAgentPrompt(null);
      this._deps.uiLogger.setAgentResponse(null);
      return;
    }
    const idle = view.state?.agent.idle ?? true;
    const text = view.agentText;
    if (text && text !== this._latestAgentResponseText) {
      this._latestAgentResponseText = text;
      this._applyAgentResponse(text, idle);
      this._deps.tts.speak(text);
      return;
    }
    if (text && idle !== this._lastIdle) {
      this._applyAgentResponse(text, idle);
    }
  }

  private _applyAgentResponse(text: string, idle: boolean): void {
    this._lastIdle = idle;
    const severity = classifyAgentResponseText(text);
    this._deps.uiLogger.setAgentResponse({
      text,
      state: idle ? "idle" : "busy",
      severity,
    });
    if (severity === "error") {
      this._deps.uiLogger.show(text, COLOR_ERROR, 3.0);
    }
  }
}
