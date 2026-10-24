import * as THREE from "three";
import * as xb from "xrblocks";
/** Authored text proportions stay consistent when the panel is resized. */
export class SurfaceText extends xb.TextView {
  private disposed = false;
  override dispose(): void { this.disposed = true; super.dispose(); }
  override updateLayout(): void {
    super.updateLayout();
    this.maxWidth = this.rangeX;
    if (this.textObj) {
      if (this.anchorX === "left") this.textObj.position.x = -this.rangeX / 2;
      if (this.anchorX === "right") this.textObj.position.x = this.rangeX / 2;
      this.textObj.raycast = () => {};
      this.createTextSDF();
    }
  }

  protected override createTextSDF(): void {
    if (this.disposed) return;
    super.createTextSDF();
    if (!this.textObj) return;
    const text = this.textObj as THREE.Mesh & { clipRect: number[]; overflowWrap: string };
    const offset = this.anchorX === "left" ? -this.rangeX / 2 : this.anchorX === "right" ? this.rangeX / 2 : 0;
    text.clipRect = [-this.rangeX / 2 - offset, -this.rangeY / 2, this.rangeX / 2 - offset, this.rangeY / 2];
    text.overflowWrap = "break-word";
  }

  color(color: string): void {
    if (this.fontColor === color) return;
    this.fontColor = color;
    this.setTextColor(color);
  }
}
