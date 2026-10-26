import * as THREE from "three";

/** Back and side faces sit behind the existing glass front, leaving picking unchanged. */
export function roundedSurfaceGeometry(width: number, height: number, radius: number, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const w = width / 2, h = height / 2, r = Math.min(radius, w, h);
  shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w, h - r); shape.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w + r, h); shape.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w, -h + r); shape.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  const extrusion = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -thickness);
  // The shader is the front face. A duplicate cap only microns behind it causes depth fighting.
  const normal = extrusion.getAttribute("normal");
  const indices: number[] = [];
  for (let i = 0; i < normal.count; i += 3) {
    if (normal.getZ(i) > 0.99 && normal.getZ(i + 1) > 0.99 && normal.getZ(i + 2) > 0.99) continue;
    indices.push(i, i + 1, i + 2);
  }
  extrusion.clearGroups(); extrusion.setIndex(indices);
  return extrusion;
}

export function surfaceBacking(width: number, height: number, radius: number, thickness: number): THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(roundedSurfaceGeometry(width, height, radius, thickness), new THREE.MeshBasicMaterial({ color: "#252528", transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  mesh.name = "Surface thickness"; mesh.raycast = () => {};
  return mesh;
}

/** Opaque button bodies stay in the UI render queue so page fades keep working. */
export function buttonSurfaceBacking(width: number, height: number, radius: number, thickness: number): ReturnType<typeof surfaceBacking> {
  const mesh = surfaceBacking(width, height, radius, thickness);
  mesh.material.opacity = 1;
  mesh.material.depthWrite = true;
  return mesh;
}

export function tintButtonBacking(backing: ReturnType<typeof surfaceBacking>, tint: THREE.Color, hover = 0): void {
  // Follow the face's animated tint and hover light, with a slightly darker side wall.
  backing.material.color.copy(tint).addScalar(hover * 0.12).multiplyScalar(0.75);
}
