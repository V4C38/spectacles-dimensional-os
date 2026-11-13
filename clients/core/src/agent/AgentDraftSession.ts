export function matchesStopCommand(text: string): boolean {
  return /\bstop\b/i.test(text);
}

export type AgentResponseSeverity = "ok" | "warn" | "error";

const ERROR_SUBSTRINGS: readonly string[] = [
  "id is blank",
  "id is too long",
  "unknown marker id",
  "No client pose",
  "No AR client connected",
];

const WARN_SUBSTRINGS: readonly string[] = ["Navigation cancelled"];

export function classifyAgentResponseText(text: string): AgentResponseSeverity {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "ok";
  }
  for (const needle of ERROR_SUBSTRINGS) {
    if (trimmed.includes(needle)) {
      return "error";
    }
  }
  for (const needle of WARN_SUBSTRINGS) {
    if (trimmed.includes(needle)) {
      return "warn";
    }
  }
  return "ok";
}

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
  private enabled = false;
  private recognizing = false;
  private starting = false;
  private holding = false;
  private flushing = false;
  private finishUntil = 0;
  private speaking = false;
  private epoch = 0;
  private synthesisGeneration = 0;
  private pendingResponse = false;
  private now = 0;
  private restartAt = 0;
  private confirmedDraft = "";
  private lastResponse: string | null = null;
  private lastResponseRevision: number | null = null;
  private snapshotValue: Omit<AgentDraftSnapshot, "status">;

  constructor(private readonly deps: {
    recognition: RecognitionPort | null;
    synthesis: SynthesisPort | null;
    send: (text: string) => void;
    estop: () => void;
    isSelected: () => boolean;
    select: () => void;
  }) {
    this.snapshotValue = { prompt: "", response: "", severity: "ok", error: null, recognitionAvailable: deps.recognition !== null };
  }

  snapshot(): AgentDraftSnapshot { return { ...this.snapshotValue, status: this.status() }; }
  private status(): AgentDraftSnapshot["status"] {
    if (!this.enabled) return "Off";
    return this.flushing ? "Transcribing…" : this.recognizing ? "Listening" : this.starting ? "Starting microphone…" :
      this.speaking ? "Responding" : this.pendingResponse ? "Thinking" : this.snapshotValue.recognitionAvailable ? "Ready" : "Type a message";
  }
  private stopSynthesis(): void {
    this.synthesisGeneration++;
    this.speaking = false;
    this.deps.synthesis?.stop();
  }
  isRecording(): boolean { return this.holding; }
  setDraft(text: string): void { this.snapshotValue.prompt = text.slice(0, 2000); }

  beginRecording(): boolean {
    if (!this.enabled || this.holding || this.flushing || !this.snapshotValue.recognitionAvailable) return false;
    this.deps.select();
    if (!this.deps.isSelected()) return false;
    this.stopSynthesis();
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
      try { this.deps.recognition.finish(); return; } catch { /* Keep the last interim draft. */ }
    }
    this.flushing = false;
    this.haltRecognition();
  }

  tick(now: number, enabled: boolean, response: string | null, idle: boolean, responseRevision?: number): void {
    this.now = now;
    if (!enabled) { if (this.enabled) this.stop(); return; }
    this.enabled = true;
    this.pendingResponse = !idle;
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
        const generation = ++this.synthesisGeneration;
        try {
          this.deps.synthesis.speak(response, () => {
            if (generation === this.synthesisGeneration) this.speaking = false;
          });
        } catch { this.speaking = false; }
      }
    }
    if (this.holding && !this.recognizing && !this.starting && now >= this.restartAt) {
      this.confirmedDraft = this.snapshotValue.prompt;
      this.listen();
    }
  }

  submitTyped(text: string): boolean {
    if (!this.enabled || !this.deps.isSelected() || this.holding || this.flushing || !text.trim()) return false;
    try {
      if (matchesStopCommand(text)) this.deps.estop();
      this.deps.send(text.trim());
      this.setDraft("");
      this.snapshotValue.error = null;
      this.pendingResponse = true;
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
    this.stopSynthesis();
    this.pendingResponse = false;
  }

  private haltRecognition(): void {
    this.epoch++;
    this.recognizing = this.starting = false;
    this.deps.recognition?.stop();
  }

  private listen(): void {
    const epoch = ++this.epoch;
    this.starting = true;
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
        this.restartAt = this.now + 0.35;
      }, () => {
        if (!this.holding || epoch !== this.epoch) return;
        this.starting = false;
        this.recognizing = true;
      });
    } catch (error) { fail(String(error)); }
  }
}
