export type MeshHit = { position: vec3; normal: vec3 };

/** A gesture-local drag plane. Scan noise never drives ordinary planar motion. */
export class DragPlacementPlane {
  private height: number;
  private targetHeight: number;
  constructor(position: vec3) { this.height = this.targetHeight = position.y; }
  solve(from: vec3, direction: vec3, hits: MeshHit[], deltaS: number,
    floorY = this.height, viewer = from): vec3 | null {
    const intersect = () => {
      if (Math.abs(direction.y) < 0.0001) return null;
      const t = (this.height - from.y) / direction.y;
      return t >= 0 ? from.add(direction.uniformScale(t)) : null;
    };
    const planar = intersect();
    if (!planar) return null;
    const hit = hits[0];
    if (hit && [hit.position.x, hit.position.y, hit.position.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite) &&
      hit.normal.length > 0.0001 && hit.normal.y / hit.normal.length >= Math.cos(Math.PI / 9) && hit.position.sub(from).dot(direction) > 0) {
      if (Math.abs(hit.position.y - this.targetHeight) > 10) this.targetHeight = hit.position.y;
    }
    const far = planar.distance(viewer) > 250;
    if (far) this.targetHeight = Math.max(floorY, this.targetHeight);
    this.height += (this.targetHeight - this.height) * (1 - Math.exp(-Math.max(0, Math.min(deltaS, 0.1)) / 0.1));
    if (far) this.height = Math.max(floorY, this.height);
    return intersect();
  }
}

/** Stable room floor: a short, spatially sampled consensus, never a raw hit. */
export class SpecsFloorReference {
  heightCm: number | null = null;
  private samples: { height: number; at: number }[] = [];
  private targetHeight: number | null = null;
  reset(height: number | null): void { this.heightCm = this.targetHeight = height; this.samples = []; }
  advance(dt: number): void {
    if (this.heightCm === null || this.targetHeight === null) return;
    this.heightCm += (this.targetHeight - this.heightCm) * (1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / 0.1));
    if (Math.abs(this.heightCm - this.targetHeight) < 0.01) this.heightCm = this.targetHeight;
  }
  observe(hit: MeshHit | undefined, now: number): boolean {
    if (!hit || this.heightCm === null || ![hit.position.x, hit.position.y, hit.position.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite) ||
      !(hit.normal.length > 0.0001 && hit.normal.y / hit.normal.length >= Math.cos(Math.PI / 9)) ||
      Math.abs(hit.position.y - this.heightCm) > 18) return false;
    if (this.samples.length && now - this.samples[this.samples.length - 1].at < 0.07) return false;
    this.samples.push({ height: hit.position.y, at: now });
    if (this.samples.length > 5) this.samples.shift();
    if (this.samples.length < 5 || now - this.samples[0].at < 0.3) return true;
    const heights = this.samples.map(sample => sample.height).sort((a, b) => a - b);
    if (heights[3] - heights[1] <= 3) this.targetHeight = heights[2];
    return true;
  }
}

/** Smooth the complete placement before it is displayed AND streamed to the robot. */
export class SpecsDragPosition {
  private value: vec3;
  constructor(position: vec3) { this.value = new vec3(position.x, position.y, position.z); }
  update(target: vec3, dt: number): vec3 {
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / 0.1);
    this.value = this.value.add(target.sub(this.value).uniformScale(alpha));
    return new vec3(this.value.x, this.value.y, this.value.z);
  }
  position(): vec3 { return new vec3(this.value.x, this.value.y, this.value.z); }
}
