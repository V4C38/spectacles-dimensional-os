import * as THREE from "three";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { composePlaceArMarker, type PlaceArMarkerArgs } from "@dimos-ar-client/agent/agentSkills";
import { clientTrackingToWebxrPoint } from "../coordinates/WebXRCoordinates";

type MarkerEntry = {
  args: PlaceArMarkerArgs;
  object: THREE.Group;
};

export class WebXRARMarkerPresenter {
  readonly object: THREE.Group;
  private readonly markers = new Map<string, MarkerEntry>();

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRARMarkerPresenter";
  }

  apply(args: PlaceArMarkerArgs, origin: ClientTrackingOrigin): void {
    const existing = this.markers.get(args.id);
    if (existing) {
      existing.args = args;
      this.place(existing.object, args, origin);
      return;
    }
    const object = createMarker(args.title);
    this.place(object, args, origin);
    this.object.add(object);
    this.markers.set(args.id, { args, object });
  }

  remove(id: string): void {
    const entry = this.markers.get(id);
    if (!entry) {
      return;
    }
    this.object.remove(entry.object);
    disposeGroup(entry.object);
    this.markers.delete(id);
  }

  recompose(origin: ClientTrackingOrigin): void {
    for (const entry of this.markers.values()) {
      this.place(entry.object, entry.args, origin);
    }
  }

  clearAll(): void {
    for (const entry of this.markers.values()) {
      this.object.remove(entry.object);
      disposeGroup(entry.object);
    }
    this.markers.clear();
  }

  dispose(): void {
    this.clearAll();
    this.object.removeFromParent();
  }

  private place(object: THREE.Group, args: PlaceArMarkerArgs, origin: ClientTrackingOrigin): void {
    const composed = composePlaceArMarker(args, origin);
    const webxr = clientTrackingToWebxrPoint(composed.position);
    object.position.set(webxr[0], webxr[1], webxr[2]);
  }
}

function createMarker(title: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `AR marker · ${title}`;
  const dark = new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.5, metalness: 0.1 });
  const accent = new THREE.MeshBasicMaterial({ color: 0xff8a24, side: THREE.DoubleSide });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.018, 32), dark);
  base.position.y = 0.012;
  const groundRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.135, 48), accent);
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.y = 0.005;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.42, 10), accent);
  stem.position.y = 0.23;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.004, 8, 32), accent);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.48;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), accent);
  core.position.y = 0.52;
  core.rotation.y = Math.PI / 4;
  for (const mesh of [base, groundRing, stem, halo, core]) {
    mesh.raycast = () => {};
    group.add(mesh);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#090909";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#383838";
      context.lineWidth = 3;
      context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
      context.fillStyle = "#ff8a24";
      context.fillRect(3, 3, 7, canvas.height - 6);
      context.fillStyle = "#a3a3a3";
      context.font = "600 22px sans-serif";
      context.fillText("AR MARKER", 30, 52);
      context.fillStyle = "#f5f5f5";
      context.font = "600 40px sans-serif";
      context.fillText(title, 30, 132, 710);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const plaque = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
      plaque.position.y = 0.68;
      plaque.scale.set(0.68, 0.17, 1);
      plaque.raycast = () => {};
      group.add(plaque);
    }
  }
  group.userData.title = title;
  return group;
}

function disposeGroup(object: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) geometries.add(child.geometry);
    if (child instanceof THREE.Sprite) child.material.map?.dispose();
    const material = (child as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach(item => materials.add(item));
    else if (material instanceof THREE.Material) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
