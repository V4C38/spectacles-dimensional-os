import { ROBOT_LINE_STYLE } from "./WorldVisualStyle";
export class RobotBoundsAnimation {
  progress = 0;
  selectedProgress = 0;
  update(selected: boolean, hovered: boolean, dt: number) {
    this.progress = clamp(
      this.progress + ((selected || hovered ? 1 : -1) * Math.max(0, dt)) / 0.24,
      0,
      1,
    );
    const ease = (t: number) => {
      const x = clamp(t, 0, 1);
      return x * x * (3 - 2 * x);
    };
    this.selectedProgress +=
      ((selected ? 1 : 0) - this.selectedProgress) *
      (1 - Math.exp(-32 * Math.max(0, dt)));
    return {
      horizontal: ease(this.progress / 0.4),
      vertical: ease((this.progress - 0.4) / 0.6),
      opacity:
        (ROBOT_LINE_STYLE.hoverOpacity +
          (ROBOT_LINE_STYLE.selectedOpacity - ROBOT_LINE_STYLE.hoverOpacity) *
            this.selectedProgress) *
        ease(this.progress / 0.4),
      width:
        ROBOT_LINE_STYLE.hoverWidthM +
        (ROBOT_LINE_STYLE.selectedWidthM - ROBOT_LINE_STYLE.hoverWidthM) *
          this.selectedProgress,
    };
  }
  reset() {
    this.progress = this.selectedProgress = 0;
  }
}

function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
