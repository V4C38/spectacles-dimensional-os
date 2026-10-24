import * as THREE from "three";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { composePlaceArMarker, type PlaceArMarkerArgs } from "@dimos-ar-client/agent/agentSkills";
import { Text } from "troika-three-text";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { disposeTextResources } from "./TextResources";
import { cornerRadius } from "./DimOSARDesign";
import { GlassSurface } from "./GlassSurface";
import { indicatorMaterial } from "./PoseIndicatorMaterial";
import { syncText, UI_FONT_REGULAR, UI_FONT_SEMIBOLD } from "./UIFonts";
import { clientTrackingToWebxrPoint } from "../utilities/WebXRCoordinates";

type MarkerEntry = {
  args: PlaceArMarkerArgs;
  object: THREE.Group;
  progress: number;
};

export class WebXRARMarkerPresenter {
  readonly object: THREE.Group;
  private readonly baseOpacity = new WeakMap<THREE.Material, number>();
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
    this.markers.set(args.id, { args, object, progress: 0 });
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

  update(cameraPosition: Vec3, deltaS: number): void {
    const eye = new THREE.Vector3(...cameraPosition);
    for (const entry of this.markers.values()) {
      entry.object.getObjectByName("World marker label")?.lookAt(eye);
      entry.progress = Math.min(1, entry.progress + Math.max(0, deltaS) / 0.18);
      const eased = entry.progress * entry.progress * (3 - 2 * entry.progress);
      entry.object.scale.setScalar(0.94 + 0.06 * eased);
      entry.object.traverse(node => {
        const material = (node as THREE.Mesh).material;
        if (!material || Array.isArray(material)) return;
        const uniforms = (material as THREE.ShaderMaterial).uniforms;
        const alpha = uniforms?.uOpacity ?? uniforms?.uAlpha;
        const base = this.baseOpacity.get(material) ?? alpha?.value ?? material.opacity;
        this.baseOpacity.set(material, base);
        if (alpha) alpha.value = base * eased;
        else material.opacity = base * eased;
      });
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
    const title = object.getObjectByName("World marker title") as Text;
    const text = args.title || "World marker";
    if (title.text !== text) { title.text = text; syncText(title); }
    object.userData.title = args.title;
  }
}

function createMarker(title: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `AR marker · ${title}`;
  const orbMaterial = indicatorMaterial(); orbMaterial.transparent = true; orbMaterial.depthWrite = false;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 24, 16), orbMaterial);
  orb.name = "World marker indicator"; orb.position.y = 0;
  const label = new THREE.Group(); label.name = "World marker label"; label.position.y = 0.10;
  const glass = new GlassSurface({ width: 0.38, height: 0.075, radius: cornerRadius(0.38, 0.075), alpha: 0.78, rim: 0.18, rimWidth: 0.0012 });
  glass.renderOrder = 20; label.add(glass);
  const text = new Text(); text.name = "World marker title";
  text.text = title || "World marker"; text.font = UI_FONT_SEMIBOLD; text.fontSize = 0.022;
  text.color = 0xffffff; text.anchorX = "center"; text.anchorY = "middle"; text.maxWidth = 0.34;
  text.position.set(0, 0.012, 0.002); text.renderOrder = 21;
  const caption = new Text(); caption.text = "World marker"; caption.font = UI_FONT_REGULAR; caption.fontSize = 0.012;
  caption.color = 0xaeaeb2; caption.anchorX = "center"; caption.anchorY = "middle";
  caption.position.set(0, -0.017, 0.002); caption.renderOrder = 21;
  label.add(text, caption); syncText(text, caption);
  group.add(orb, label);
  group.traverse(node => { node.raycast = () => {}; });
  group.userData.title = title;
  return group;
}

function disposeGroup(object: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (child instanceof Text) { disposeTextResources(child); return; }
    else if (child instanceof THREE.Mesh || child instanceof THREE.Line) geometries.add(child.geometry);
    if (child instanceof THREE.Sprite) child.material.map?.dispose();
    const material = (child as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach(item => materials.add(item));
    else if (material instanceof THREE.Material) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
