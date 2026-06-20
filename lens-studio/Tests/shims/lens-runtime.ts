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
