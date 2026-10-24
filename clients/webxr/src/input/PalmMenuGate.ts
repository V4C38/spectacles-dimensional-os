import * as THREE from "three";

/** Palm geometry uses metacarpals so bent pointing/pinching fingers cannot invert it. */
export function palmUpDot(handedness: XRHandedness, joints: ReadonlyMap<string, THREE.Vector3>): number | null {
  const wrist = joints.get("wrist"), index = joints.get("index-finger-metacarpal"), middle = joints.get("middle-finger-metacarpal"), little = joints.get("pinky-finger-metacarpal");
  if (!wrist || !index || !middle || !little || handedness === "none") return null;
  for (const finger of ["middle", "ring"]) {
    const base = joints.get(`${finger}-finger-phalanx-proximal`), mid = joints.get(`${finger}-finger-phalanx-intermediate`), tip = joints.get(`${finger}-finger-tip`);
    if (!base || !mid || !tip) return null;
    const a = base.clone().sub(mid), b = tip.clone().sub(mid);
    if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8 || a.angleTo(b) < 150 * Math.PI / 180) return 0;
  }
  const normal = index.clone().sub(little).cross(middle.clone().sub(wrist));
  if (normal.lengthSq() < 1e-8) return null;
  return normal.normalize().y * (handedness === "left" ? -1 : 1);
}

export class PalmMenuGate {
  isOpen = false;
  private pending: boolean | null = null;
  private since = 0;
  update(dotUp: number | null, now: number): boolean {
    const wantsOpen = dotUp !== null && dotUp >= Math.cos((this.isOpen ? 55 : 35) * Math.PI / 180);
    if (wantsOpen === this.isOpen) { this.pending = null; return false; }
    if (this.pending !== wantsOpen) { this.pending = wantsOpen; this.since = now; return false; }
    if (now - this.since < (wantsOpen ? 0.35 : 0.18)) return false;
    this.isOpen = wantsOpen;
    this.pending = null;
    return true;
  }
  reset(): void { this.isOpen = false; this.pending = null; }
}
