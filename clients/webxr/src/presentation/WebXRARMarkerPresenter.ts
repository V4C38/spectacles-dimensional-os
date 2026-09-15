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
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xff66aa }),
  );
  group.add(mesh);
  group.userData.title = title;
  return group;
}

function disposeGroup(object: THREE.Group): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}
