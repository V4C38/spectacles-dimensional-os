import { AgentDraftSession, type AgentDraftSnapshot, type RecognitionPort, type SynthesisPort } from "../../DimOSARClient/agent/AgentDraftSession";
import { requestUserMessage } from "../../DimOSARClient/agent/userMessageRequest";
import type { ARModuleSession } from "../../DimOSARClient/websocket/arModuleSession";
import type { OperatingMode } from "../presentation/AppState";

export interface AgentSpeechControllerDeps {
  asrModule: AsrModule | null;
  session: ARModuleSession;
  tts: SynthesisPort & { tick(): void };
  getOperatingMode: () => OperatingMode;
  isSelected: () => boolean;
  select: () => void;
  isSetupCompleted: () => boolean;
  emergencyStop: () => void;
}

/** Native speech is an adapter; draft, recording and submission belong to ClientCore. */
export class AgentSpeechController {
  readonly draft: AgentDraftSession;
  private readonly recognition: SpecsRecognition | null;
  private bound = false;

  constructor(private readonly deps: AgentSpeechControllerDeps) {
    this.recognition = deps.asrModule ? new SpecsRecognition(deps.asrModule) : null;
    this.draft = new AgentDraftSession({
      recognition: this.recognition,
      synthesis: deps.tts,
      send: text => requestUserMessage(deps.session, text),
      estop: deps.emergencyStop,
      isSelected: deps.isSelected,
      select: deps.select,
    });
  }

  get asrRunning(): boolean { return this.draft.isRecording(); }
  snapshot(): AgentDraftSnapshot { return this.draft.snapshot(); }
  bind(): void { this.bound = true; this.syncEnabled(); }
  beginRecording(): boolean { this.syncEnabled(); return this.draft.beginRecording(); }
  endRecording(cancel = false): void { this.draft.endRecording(cancel); }
  setDraft(text: string): void { this.draft.setDraft(text); }
  submit(): boolean { return this.draft.submitTyped(this.draft.snapshot().prompt); }
  reset(): void { this.draft.reset(); }
  dispose(): void { this.bound = false; this.draft.stop(); }
  tick(): void { this.recognition?.tick(); this.deps.tts.tick(); this.syncEnabled(); }

  syncEnabled(): void {
    if (!this.bound) return;
    const view = this.deps.session.view();
    const enabled = this.deps.isSetupCompleted() && this.deps.getOperatingMode() === "agent" &&
      view.connection === "ready" && view.capabilities?.agent.available === true;
    this.draft.tick(getTime(), enabled, view.agentMessage, view.state?.agent.idle ?? true);
  }
}

/** stop/finish keep separate generations so delayed native callbacks cannot revive a draft. */
export class SpecsRecognition implements RecognitionPort {
  private generation = 0;
  private active = false;
  private ended: (() => void) | null = null;
  private pendingStop: Promise<void> = Promise.resolve();
  private finishingUntil: number | null = null;

  constructor(private readonly module: AsrModule) {}

  start(onText: (text: string, final: boolean) => void, onError: (reason: string) => void,
    onEnd: () => void, onStarted: () => void): void {
    const generation = ++this.generation;
    this.active = true; this.ended = onEnd; this.finishingUntil = null;
    void this.pendingStop.then(() => {
      if (generation !== this.generation || !this.active) return;
      try {
        const options = AsrModule.AsrTranscriptionOptions.create();
        options.mode = AsrModule.AsrMode.HighAccuracy;
        options.silenceUntilTerminationMs = 1000;
        options.onTranscriptionUpdateEvent.add(event => {
          if (generation !== this.generation || !this.active) return;
          onText(event.text, event.isFinal);
          if (event.isFinal) this.end();
        });
        options.onTranscriptionErrorEvent.add(code => {
          if (generation !== this.generation || !this.active) return;
          onError(code === AsrModule.AsrStatusCode.Unauthenticated ? "service-not-allowed" :
            code === AsrModule.AsrStatusCode.NoInternet ? "network" : `native-${code}`);
        });
        this.module.startTranscribing(options); onStarted();
      } catch (error) { if (generation === this.generation) onError(String(error)); }
    });
  }

  // Native stop discards the session. Let the silence boundary deliver its final
  // transcript first, retaining the latest interim draft if no final arrives.
  finish(): void { this.finishingUntil = getTime() + 1.1; }
  tick(): void {
    if (this.finishingUntil !== null && getTime() >= this.finishingUntil) {
      const end = this.ended; this.stop(); end?.();
    }
  }
  private end(): void {
    this.active = false; this.finishingUntil = null;
    const end = this.ended; this.ended = null; end?.();
  }
  stop(): void {
    this.generation++; this.ended = null; this.finishingUntil = null;
    if (!this.active) return;
    this.active = false;
    this.pendingStop = this.pendingStop.then(() => this.module.stopTranscribing()).catch(() => {});
  }
}
