import { StopCommandMatcher } from "./AgentSpeechSession";
import { classifyAgentResponseText, type AgentResponseSeverity } from "./AgentResponseClassification";

export interface RecognitionPort {
  start(onText: (text: string, final: boolean) => void, onError: (reason: string) => void, onEnd: () => void, onStarted: () => void): void;
  stop(): void;
  finish?(): void;
}
export interface SynthesisPort {
  speak(text: string, onEnd: () => void): void;
  stop(): void;
}
export interface AgentDraftSnapshot {
  status: "Off" | "Ready" | "Starting microphone…" | "Listening" | "Transcribing…" | "Thinking" | "Responding" | "Type a message";
  prompt: string;
  response: string;
  severity: AgentResponseSeverity;
  error: string | null;
  recognitionAvailable: boolean;
}

/** Dictation edits a draft. Only an explicit Send can issue a command. */
export class AgentDraftSession {
  private readonly stopMatcher = new StopCommandMatcher();
  private enabled = false;
  private recognizing = false;
  private starting = false;
  private holding = false;
  private flushing = false;
  private finishUntil = 0;
  private speaking = false;
  private epoch = 0;
  private now = 0;
  private restartAt = 0;
  private confirmedDraft = "";
  private lastResponse: string | null = null;
  private lastResponseRevision: number | null = null;
  private snapshotValue: AgentDraftSnapshot;

  constructor(private readonly deps: {
    recognition: RecognitionPort | null;
    synthesis: SynthesisPort | null;
    send: (text: string) => void;
    estop: () => void;
    isSelected: () => boolean;
    select: () => void;
  }) {
    this.snapshotValue = { status: "Off", prompt: "", response: "", severity: "ok", error: null, recognitionAvailable: deps.recognition !== null };
  }

  snapshot(): AgentDraftSnapshot { return { ...this.snapshotValue }; }
  isRecording(): boolean { return this.holding; }
  setDraft(text: string): void { this.snapshotValue.prompt = text.slice(0, 2000); }

  beginRecording(): boolean {
    if (!this.enabled || this.holding || this.flushing || !this.snapshotValue.recognitionAvailable) return false;
    this.deps.select();
    if (!this.deps.isSelected()) return false;
    this.deps.synthesis?.stop();
    this.speaking = false;
    this.holding = true;
    this.confirmedDraft = this.snapshotValue.prompt;
    this.snapshotValue.error = null;
    this.listen();
    return true;
  }

  endRecording(cancel = false): void {
    if (this.flushing && !cancel) return;
    if (!this.holding && !this.starting && !this.recognizing && !this.flushing) return;
    this.holding = false;
    if (!cancel && this.recognizing && this.deps.recognition?.finish) {
      this.recognizing = false;
      this.flushing = true;
      this.finishUntil = this.now + 1.5;
      this.snapshotValue.status = "Transcribing…";
      try { this.deps.recognition.finish(); return; } catch { /* Keep the last interim draft. */ }
    }
    this.flushing = false;
    this.haltRecognition();
    this.snapshotValue.status = this.enabled ? "Ready" : "Off";
  }

  tick(now: number, enabled: boolean, response: string | null, idle: boolean, responseRevision?: number): void {
    this.now = now;
    if (!enabled) { if (this.enabled) this.stop(); return; }
    this.enabled = true;
    if (this.flushing && now >= this.finishUntil) this.endRecording(true);
    const newResponse = responseRevision === undefined
      ? response !== this.lastResponse : responseRevision !== this.lastResponseRevision;
    if (response && newResponse) {
      this.lastResponse = response;
      this.lastResponseRevision = responseRevision ?? null;
      this.snapshotValue.response = response;
      this.snapshotValue.severity = classifyAgentResponseText(response);
      if (this.deps.synthesis && !this.holding && !this.flushing) {
        this.speaking = true;
        const epoch = this.epoch;
        try {
          this.deps.synthesis.speak(response, () => {
            if (epoch === this.epoch) this.speaking = false;
          });
        } catch { this.speaking = false; }
      }
    }
    if (this.holding && !this.recognizing && !this.starting && now >= this.restartAt) {
      this.confirmedDraft = this.snapshotValue.prompt;
      this.listen();
    }
    this.snapshotValue.status = this.flushing ? "Transcribing…" : this.recognizing ? "Listening" : this.starting ? "Starting microphone…" :
      this.speaking ? "Responding" : !idle ? "Thinking" : this.snapshotValue.recognitionAvailable ? "Ready" : "Type a message";
  }

  submitTyped(text: string): boolean {
    if (!this.enabled || !this.deps.isSelected() || this.holding || this.flushing || !text.trim()) return false;
    try {
      if (this.stopMatcher.check(text, true)) this.deps.estop();
      this.deps.send(text.trim());
      this.setDraft("");
      this.snapshotValue.error = null;
      this.snapshotValue.status = "Thinking";
      return true;
    } catch (error) { this.snapshotValue.error = String(error); return false; }
  }

  reset(): void {
    this.stop();
    this.snapshotValue.prompt = this.snapshotValue.response = "";
    this.lastResponse = null;
    this.lastResponseRevision = null;
    this.snapshotValue.error = null;
  }

  stop(): void {
    this.enabled = false;
    this.endRecording(true);
    this.haltRecognition();
    this.deps.synthesis?.stop();
    this.speaking = false;
    this.stopMatcher.reset();
    this.snapshotValue.status = "Off";
  }

  private haltRecognition(): void {
    this.epoch++;
    this.recognizing = this.starting = false;
    this.deps.recognition?.stop();
  }

  private listen(): void {
    const epoch = ++this.epoch;
    this.starting = true;
    this.snapshotValue.status = "Starting microphone…";
    const fail = (reason: string) => {
      if (epoch !== this.epoch) return;
      this.snapshotValue.error = `Speech unavailable: ${reason}.`;
      this.snapshotValue.recognitionAvailable = !["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(reason);
      this.endRecording(true);
    };
    try {
      this.deps.recognition?.start((text, final) => {
        if (!this.enabled || (!this.holding && !this.flushing) || epoch !== this.epoch) return;
        this.setDraft([this.confirmedDraft, text.trim()].filter(Boolean).join(" "));
        if (final) this.confirmedDraft = this.snapshotValue.prompt;
      }, fail, () => {
        if (epoch !== this.epoch) return;
        this.recognizing = this.starting = false;
        if (this.flushing) { this.flushing = false; this.epoch++; }
        this.snapshotValue.status = "Ready";
        this.restartAt = this.now + 0.35;
      }, () => {
        if (!this.holding || epoch !== this.epoch) return;
        this.starting = false;
        this.recognizing = true;
        this.snapshotValue.status = "Listening";
      });
    } catch (error) { fail(String(error)); }
  }
}
