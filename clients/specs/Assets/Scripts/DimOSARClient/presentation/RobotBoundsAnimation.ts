import { robotOutlineFrame } from "./WorldVisualStyle";
export class RobotBoundsAnimation {
  progress = 0;
  selectedProgress = 0;
  update(selected: boolean, hovered: boolean, dt: number) {
    this.progress = clamp(
      this.progress + ((selected || hovered ? 1 : -1) * Math.max(0, dt)) / 0.24,
      0,
      1,
    );
    this.selectedProgress +=
      ((selected ? 1 : 0) - this.selectedProgress) *
      (1 - Math.exp(-32 * Math.max(0, dt)));
    const frame = robotOutlineFrame(this.progress, this.selectedProgress);
    return { horizontal: frame.horizontal, vertical: frame.vertical, opacity: frame.opacity, width: frame.widthM };
  }
  reset() {
    this.progress = this.selectedProgress = 0;
  }
}

function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
