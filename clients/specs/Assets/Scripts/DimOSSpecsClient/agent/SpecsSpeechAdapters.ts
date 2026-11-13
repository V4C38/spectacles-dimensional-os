import type { RecognitionPort } from "DimOSARClient.lspkg/Scripts/DimOSARClient/agent/AgentDraftSession";

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

export interface SpecsTextToSpeechDeps {
  module: TextToSpeechModule;
  audio: AudioComponent;
}

/** Owns the sole Lens TextToSpeechModule and its AudioComponent. */
export class SpecsTextToSpeech {
  private readonly _module: TextToSpeechModule;
  private readonly _audio: AudioComponent;
  private _queue: string[] = [];
  private _synthesizing = false;
  private generation = 0;
  private onEnd: (() => void) | null = null;

  constructor(deps: SpecsTextToSpeechDeps) {
    this._module = deps.module;
    this._audio = deps.audio;
  }

  public get isPlaying(): boolean {
    if (this._synthesizing) {
      return true;
    }
    const audio = this._audio as AudioComponent & { isPlaying?: () => boolean };
    if (audio.enabled === false || audio.isEnabledInHierarchy === false) return false;
    if (typeof audio.isPlaying === "function") {
      return audio.isPlaying();
    }
    return false;
  }

  public speak(text: string, onEnd?: () => void): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      onEnd?.();
      return;
    }
    this.onEnd = onEnd ?? null;
    this._queue.push(trimmed);
    this._pump();
  }

  public stop(): void {
    this.generation++;
    this.onEnd = null;
    this._queue = [];
    this._synthesizing = false;
    const audio = this._audio as AudioComponent & { stop?: (fade: boolean) => void };
    // Lens also throws for an enabled but idle component with no native player.
    // Stopping is only necessary while audio is actually playing.
    if (audio.enabled !== false && audio.isEnabledInHierarchy !== false && this.isPlaying && typeof audio.stop === "function") {
      audio.stop(false);
    }
  }

  public tick(): void {
    if (!this.isPlaying && this._queue.length === 0 && this.onEnd) {
      const end = this.onEnd; this.onEnd = null; end();
    }
    if (this._synthesizing || this._queue.length === 0) {
      return;
    }
    if (this.isPlaying) {
      return;
    }
    this._pump();
  }

  private _pump(): void {
    if (this._synthesizing || this._queue.length === 0) {
      return;
    }
    if (this.isPlaying && this._queue.length > 0 && !this._synthesizing) {
      return;
    }
    const next = this._queue.shift();
    if (!next) {
      return;
    }
    this._synthesize(next);
  }

  private _synthesize(text: string): void {
    const generation = this.generation;
    this._synthesizing = true;
    try {
      const options = TextToSpeech.Options.create();
      this._module.synthesize(text, options,
        (audioTrack: AudioTrackAsset) => {
          if (generation !== this.generation) return;
          this._synthesizing = false;
          try { this._audio.audioTrack = audioTrack; this._audio.play(1); }
          catch (error) { this.fail(String(error)); }
        },
        (_errorCode: number, description: string) => {
          if (generation === this.generation) this.fail(description || "TTS synthesis failed");
        });
    } catch (error) {
      this.fail(String(error));
      throw error;
    }
  }

  private fail(message: string): void {
    this.generation++;
    this._synthesizing = false;
    this._queue = [];
    const end = this.onEnd; this.onEnd = null;
    print(`Speech synthesis failed: ${message}`);
    end?.();
  }
}
