import * as THREE from "three";

type Cue = "hover" | "move" | "select" | "activate" | "confirm";
const PRESETS: Record<Cue, { frequency: number; duration: number; gain: number }> = {
  hover: { frequency: 620, duration: 0.025, gain: 0.009 },
  move: { frequency: 460, duration: 0.025, gain: 0.008 },
  select: { frequency: 740, duration: 0.04, gain: 0.018 },
  activate: { frequency: 680, duration: 0.03, gain: 0.014 },
  confirm: { frequency: 880, duration: 0.055, gain: 0.024 },
};

/** Quiet host feedback. No queued cues, autonomous loops, or audio state in ClientCore. */
export class InteractionSoundController {
  enabled = true;
  private context: AudioContext | null = null;
  private suspended = true;
  private suppressed = false;
  private readonly playing = new Set<OscillatorNode>();
  private lastCue = -Infinity;
  private hover: object | null = null;
  private hoverSince = 0;
  private hoverPlayed = false;
  private readonly hoverTimes = new WeakMap<object, number>();
  private lastMove = -Infinity;
  private lastPosition: THREE.Vector3 | null = null;
  private wasDragging = false;
  private wasSelected: boolean | null = null;

  constructor() {
    try { this.enabled = localStorage.getItem("dimos-ar-sound") !== "off"; } catch { /* Storage is optional. */ }
  }
  async unlock(): Promise<void> {
    try {
      this.context ??= THREE.AudioContext.getContext() as unknown as AudioContext;
      if (this.context.state === "suspended") await this.context.resume();
    } catch { this.context = null; }
  }
  toggle(): void {
    this.enabled = !this.enabled;
    try { localStorage.setItem("dimos-ar-sound", this.enabled ? "on" : "off"); } catch { /* Storage is optional. */ }
    if (!this.enabled) this.stop();
  }
  setActive(active: boolean): void { this.suspended = !active; if (!active) { this.stop(); this.hover = null; this.wasDragging = false; this.wasSelected = null; } }
  setSuppressed(suppressed: boolean): void { this.suppressed = suppressed; if (suppressed) this.stop(); }
  play(cue: Cue, now = performance.now() / 1000): void {
    const context = this.context;
    if (!this.enabled || this.suspended || this.suppressed || !context || context.state !== "running" || now - this.lastCue < 0.1) return;
    this.lastCue = now;
    const preset = PRESETS[cue], start = context.currentTime;
    const oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(preset.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(preset.frequency * 0.82, start + preset.duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(preset.gain, start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.00001, start + preset.duration);
    oscillator.connect(envelope); envelope.connect(context.destination);
    oscillator.onended = () => { this.playing.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    this.playing.add(oscillator); oscillator.start(start); oscillator.stop(start + preset.duration + 0.005);
  }
  update(hover: object | null, selected: boolean, dragging: boolean, position: THREE.Vector3, now: number): void {
    if (hover !== this.hover) { this.hover = hover; this.hoverSince = now; this.hoverPlayed = false; }
    if (hover && !this.hoverPlayed && now - this.hoverSince >= 0.08) {
      this.hoverPlayed = true;
      if (now - (this.hoverTimes.get(hover) ?? -Infinity) >= 0.5) { this.hoverTimes.set(hover, now); this.play("hover", now); }
    }
    if (this.wasSelected !== null && selected !== this.wasSelected) this.play("select", now);
    this.wasSelected = selected;
    if (dragging !== this.wasDragging) {
      this.play(dragging ? "select" : "confirm", now);
      this.lastPosition = position.clone(); this.lastMove = now;
    } else if (dragging && this.lastPosition && now - this.lastMove >= 0.5 && position.distanceTo(this.lastPosition) >= 0.2) {
      this.play("move", now); this.lastMove = now; this.lastPosition.copy(position);
    }
    this.wasDragging = dragging;
  }
  stop(): void { for (const node of this.playing) { try { node.stop(); } catch { /* Already ended. */ } } this.playing.clear(); }
  dispose(): void { this.stop(); this.context = null; }
}
