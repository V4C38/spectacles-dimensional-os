export class vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  normalize(): vec3 {
    const n = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= n;
    this.y /= n;
    this.z /= n;
    return this;
  }

  static lerp(a: vec3, b: vec3, t: number): vec3 {
    return new vec3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  }
}

export class vec4 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 0,
  ) {}
}

export class quat {
  constructor(
    public w = 1,
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  normalize(): void {
    const n = Math.hypot(this.w, this.x, this.y, this.z) || 1;
    this.w /= n;
    this.x /= n;
    this.y /= n;
    this.z /= n;
  }

  static quatIdentity(): quat {
    return new quat(1, 0, 0, 0);
  }

  static angleBetween(a: quat, b: quat): number {
    const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
    return 2 * Math.acos(Math.min(1, dot));
  }

  static slerp(a: quat, b: quat, t: number): quat {
    let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    let bx = b.w;
    let by = b.x;
    let bz = b.y;
    let bw = b.z;
    if (dot < 0) {
      dot = -dot;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    if (dot > 0.9995) {
      const result = new quat(
        a.w + t * (bx - a.w),
        a.x + t * (by - a.x),
        a.y + t * (bz - a.y),
        a.z + t * (bw - a.z),
      );
      result.normalize();
      return result;
    }
    const theta = Math.acos(Math.min(1, dot));
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sinTheta;
    const wb = Math.sin(t * theta) / sinTheta;
    return new quat(
      wa * a.w + wb * bx,
      wa * a.x + wb * by,
      wa * a.y + wb * bz,
      wa * a.z + wb * bw,
    );
  }

  multiplyVec3(v: vec3): vec3 {
    const qx = this.x;
    const qy = this.y;
    const qz = this.z;
    const qw = this.w;
    const ix = qw * v.x + qy * v.z - qz * v.y;
    const iy = qw * v.y + qz * v.x - qx * v.z;
    const iz = qw * v.z + qx * v.y - qy * v.x;
    const iw = -qx * v.x - qy * v.y - qz * v.z;
    return new vec3(
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx,
    );
  }
}

export class mat4 {
  readonly column0: vec3;
  readonly column1: vec3;
  readonly column2: vec3;

  constructor(
    column0: vec3 = new vec3(1, 0, 0),
    column1: vec3 = new vec3(0, 1, 0),
    column2: vec3 = new vec3(0, 0, 1),
  ) {
    this.column0 = column0;
    this.column1 = column1;
    this.column2 = column2;
  }

  static fromRotationY(radians: number): mat4 {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return new mat4(
      new vec3(c, 0, -s),
      new vec3(0, 1, 0),
      new vec3(s, 0, c),
    );
  }
}
