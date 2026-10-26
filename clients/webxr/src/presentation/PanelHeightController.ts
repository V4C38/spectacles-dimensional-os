import { CONTROL_PANEL_LAYOUT } from "@dimos-ar-client/presentation/ControlPanelPresentation";

export const PANEL_RESIZE_S = 0.28;

/** Interruptible height animation. The host keeps its top reference stationary. */
export class PanelHeightController {
  height: number = CONTROL_PANEL_LAYOUT.height;
  target = this.height;
  private start = this.height;
  private elapsed = PANEL_RESIZE_S;

  request(height: number, immediate = false): void {
    if (immediate) { this.height = this.target = this.start = height; this.elapsed = PANEL_RESIZE_S; return; }
    if (height === this.target) return;
    this.start = this.height; this.target = height; this.elapsed = 0;
  }
  tick(deltaS: number, paused = false): void {
    if (paused || this.height === this.target) return;
    this.elapsed = Math.min(PANEL_RESIZE_S, this.elapsed + Math.max(0, deltaS));
    const t = this.elapsed / PANEL_RESIZE_S;
    this.height = this.elapsed === PANEL_RESIZE_S ? this.target : this.start + (this.target - this.start) * t * t * (3 - 2 * t);
  }
}
