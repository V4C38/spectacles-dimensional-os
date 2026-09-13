export type SpecsTextToSpeechErrorHandler = (message: string) => void;

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
  private _errorHandler: SpecsTextToSpeechErrorHandler | null = null;

  constructor(deps: SpecsTextToSpeechDeps) {
    this._module = deps.module;
    this._audio = deps.audio;
  }

  public onError(handler: SpecsTextToSpeechErrorHandler): void {
    this._errorHandler = handler;
  }

  public get isPlaying(): boolean {
    if (this._synthesizing) {
      return true;
    }
    const audio = this._audio as AudioComponent & { isPlaying?: () => boolean };
    if (typeof audio.isPlaying === "function") {
      return audio.isPlaying();
    }
    return false;
  }

  public speak(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    this._queue.push(trimmed);
    this._pump();
  }

  public stop(): void {
    this._queue = [];
    this._synthesizing = false;
    const audio = this._audio as AudioComponent & { stop?: (fade: boolean) => void };
    if (typeof audio.stop === "function") {
      audio.stop(false);
    }
  }

  public tick(): void {
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
    this._synthesizing = true;
    const options = TextToSpeech.Options.create();
    this._module.synthesize(
      text,
      options,
      (audioTrack: AudioTrackAsset) => {
        this._synthesizing = false;
        this._audio.audioTrack = audioTrack;
        this._audio.play(1);
      },
      (_errorCode: number, description: string) => {
        this._synthesizing = false;
        const message = description || "TTS synthesis failed";
        this._errorHandler?.(message);
      },
    );
  }
}
