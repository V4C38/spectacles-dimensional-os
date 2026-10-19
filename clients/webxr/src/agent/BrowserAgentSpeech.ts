import {
  closeAgentSpeechSession, createAgentSpeechSessionState, deriveAgentPromptEntry,
  isAgentSpeechSessionExpired, reduceFinalTranscript, StopCommandMatcher,
} from "@dimos-ar-client/agent/AgentSpeechSession";
import { classifyAgentResponseText, type AgentResponseSeverity } from "@dimos-ar-client/agent/AgentResponseClassification";

export interface RecognitionPort {
  start(onText: (text: string, final: boolean) => void, onError: (reason: string) => void, onEnd: () => void): void;
  stop(): void;
}
export interface SynthesisPort {
  speak(text: string, onEnd: () => void): void;
  stop(): void;
}
export interface SpeechSnapshot {
  status: "Off" | "Listening" | "Thinking" | "Responding" | "Type a message";
  prompt: string;
  response: string;
  severity: AgentResponseSeverity;
  error: string | null;
  recognitionAvailable: boolean;
}

export class BrowserAgentSpeech {
  private conversation = createAgentSpeechSessionState();
  private readonly stopMatcher = new StopCommandMatcher();
  private enabled = false;
  private recognizing = false;
  private speaking = false;
  private epoch = 0;
  private now = 0;
  private restartAt = 0;
  private lastResponse: string | null = null;
  private snapshotValue: SpeechSnapshot;

  constructor(private readonly deps: {
    recognition: RecognitionPort | null;
    synthesis: SynthesisPort | null;
    send: (text: string) => void;
    estop: () => void;
  }) {
    this.snapshotValue = { status: "Off", prompt: "", response: "", severity: "ok", error: null, recognitionAvailable: deps.recognition !== null };
  }

  snapshot(): SpeechSnapshot { return { ...this.snapshotValue }; }

  tick(now: number, enabled: boolean, response: string | null, idle: boolean): void {
    this.now = now;
    if (!enabled) { if (this.enabled) this.stop(); return; }
    this.enabled = true;
    if (isAgentSpeechSessionExpired(this.conversation, now)) {
      this.conversation = closeAgentSpeechSession(this.conversation);
      this.snapshotValue.prompt = "";
    }
    if (response && response !== this.lastResponse) {
      this.lastResponse = response;
      this.snapshotValue.response = response;
      this.snapshotValue.severity = classifyAgentResponseText(response);
      if (this.deps.synthesis) {
        this.haltRecognition();
        this.speaking = true;
        const epoch = this.epoch;
        try {
          this.deps.synthesis.speak(response, () => {
            if (epoch !== this.epoch) return;
            this.speaking = false;
            this.restartAt = this.now + 0.35;
          });
        } catch { this.speaking = false; }
      }
    }
    if (!this.speaking && !this.recognizing && now >= this.restartAt && this.snapshotValue.recognitionAvailable) this.listen();
    this.snapshotValue.status = this.speaking ? "Responding" : !idle ? "Thinking" :
      this.snapshotValue.recognitionAvailable ? "Listening" : "Type a message";
  }

  submitTyped(text: string): boolean {
    if (!this.enabled || !text.trim()) return false;
    this.checkStop(text, true);
    try {
      this.deps.send(text.trim());
      this.snapshotValue.prompt = text.trim();
      this.snapshotValue.status = "Thinking";
      return true;
    } catch (error) { this.snapshotValue.error = String(error); return false; }
  }

  stop(): void {
    this.enabled = false;
    this.haltRecognition();
    this.deps.synthesis?.stop();
    this.speaking = false;
    this.conversation = closeAgentSpeechSession(this.conversation);
    this.stopMatcher.reset();
    this.lastResponse = null;
    this.snapshotValue.status = "Off";
    this.snapshotValue.prompt = "";
  }

  private haltRecognition(): void {
    this.epoch++;
    this.recognizing = false;
    this.deps.recognition?.stop();
  }

  private checkStop(text: string, final: boolean): void {
    if (this.stopMatcher.check(text, final)) this.deps.estop();
  }

  private listen(): void {
    const epoch = ++this.epoch;
    this.recognizing = true;
    try {
      this.deps.recognition?.start((text, final) => {
        if (!this.enabled || this.speaking || epoch !== this.epoch) return;
        this.checkStop(text, final);
        const entry = deriveAgentPromptEntry(this.conversation, text);
        this.snapshotValue.prompt = entry?.text ?? "";
        if (!final) return;
        const reduced = reduceFinalTranscript(this.conversation, text, this.now);
        this.conversation = reduced.state;
        if (reduced.action.kind === "send") {
          try { this.deps.send(reduced.action.text); this.snapshotValue.status = "Thinking"; }
          catch (error) { this.snapshotValue.error = String(error); }
        }
      }, reason => {
        if (epoch !== this.epoch) return;
        this.snapshotValue.error = `Speech unavailable: ${reason}. Use Type a message.`;
        this.snapshotValue.recognitionAvailable = false;
        this.haltRecognition();
      }, () => {
        if (epoch !== this.epoch) return;
        this.recognizing = false;
        this.restartAt = this.now + 0.5;
      });
    } catch (error) {
      this.snapshotValue.error = `Speech unavailable: ${String(error)}. Use Type a message.`;
      this.snapshotValue.recognitionAvailable = false;
      this.haltRecognition();
    }
  }
}

// Host-only Web Speech API adapter. No browser APIs enter ClientCore.
interface BrowserRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

export function browserRecognition(): RecognitionPort | null {
  const host = window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Constructor) return null;
  let current: BrowserRecognition | null = null;
  return {
    start(onText, onError, onEnd) {
      const recognition = new Constructor();
      current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = event => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          onText(result[0].transcript, result.isFinal);
        }
      };
      recognition.onerror = event => onError(event.error);
      recognition.onend = onEnd;
      recognition.start();
    },
    stop() {
      if (!current) return;
      current.onresult = null; current.onerror = null; current.onend = null;
      current.abort(); current = null;
    },
  };
}

export function browserSynthesis(): SynthesisPort | null {
  if (!window.speechSynthesis) return null;
  return {
    speak(text, onEnd) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
      window.speechSynthesis.speak(utterance);
    },
    stop() { window.speechSynthesis.cancel(); },
  };
}
