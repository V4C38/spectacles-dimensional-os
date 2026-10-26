import { cursorLaserFrame, type LaserPointer } from "./CursorLaserGeometry";
import { BendyLaserRenderer, type LaserVisual } from "./BendyLaserRenderer";

/** One optical addon per SIK pointer; never writes to the interactor or cursor. */
export class SpecsLaserPresenter {
  private readonly beams = new Map<number, { visual: LaserVisual }>();
  private disposed = false;

  constructor(private readonly parent: SceneObject, private readonly readPointers: () => readonly LaserPointer[],
    private readonly createVisual = (parent: SceneObject, id: number): LaserVisual =>
      new BendyLaserRenderer(parent, `SIK cursor beam ${id}`)) {}

  tick(): void {
    if (this.disposed) return;
    const seen = new Set<number>();
    for (const pointer of this.readPointers()) {
      seen.add(pointer.id);
      let beam = this.beams.get(pointer.id);
      if (!beam && pointer.active && pointer.shown && pointer.opacity > 0.01) {
        beam = { visual: this.createVisual(this.parent, pointer.id) };
        this.beams.set(pointer.id, beam);
      }
      if (!beam) continue;
      const frame = cursorLaserFrame(pointer);
      if (frame) beam.visual.apply(frame);
      else beam.visual.hide();
    }
    for (const [id, beam] of this.beams) if (!seen.has(id)) {
      beam.visual.destroy(); this.beams.delete(id);
    }
  }

  reset(): void {
    for (const beam of this.beams.values()) beam.visual.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const beam of this.beams.values()) beam.visual.destroy();
    this.beams.clear();
  }
}
