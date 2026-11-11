import type { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import {
composePlaceArMarker,
type PlaceArMarkerArgs,
} from "../../DimOSARClient/agent/agentSkills";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { clientTrackingToSpecsPoint } from "../utilities/SpecsCoordinates";
import { COLOR_WHITE,createRoundedSurface,createText } from "./UIKit";
import { WorldMeshRenderer,sphereMesh } from "./WorldMeshRenderer";

export interface ARMarkerPresenterDeps {
  parent: SceneObject;
  markerPrefab: ObjectPrefab | null;
}

type MarkerEntry = {
  root: SceneObject;
  args: PlaceArMarkerArgs;
  progress: number;
  lastOpacity?: number;
  visual?: { orb: WorldMeshRenderer; label: SceneObject; title: Text; caption: Text; plate: RoundedRectangle };
};

/** Owns world-anchored ar_place_marker visuals in the Specs tracking frame. */
const MARKER_SPHERE = sphereMesh(2.5, 24, 16);

export class ARMarkerPresenter {
  private readonly _parent: SceneObject;
  private readonly _markerPrefab: ObjectPrefab | null;
  private readonly _entries = new Map<string, MarkerEntry>();

  constructor(deps: ARMarkerPresenterDeps) {
    this._parent = deps.parent;
    this._markerPrefab = deps.markerPrefab;
  }

  public apply(
    args: PlaceArMarkerArgs,
    origin: ClientTrackingOrigin,
  ): { ok: boolean; error?: string } {
    if (!this._markerPrefab) {
      return { ok: false, error: "AR marker prefab is not assigned" };
    }
    const composed = composePlaceArMarker(args, origin);
    const existing = this._entries.get(args.id);
    if (existing) {
      existing.args = args;
      placeMarker(existing.root, composed.position);
      return { ok: true };
    }
    const root = this._markerPrefab.instantiate(this._parent);
    placeMarker(root, composed.position);
    this._entries.set(args.id, { root, args, progress: 0 });
    return { ok: true };
  }

  public recompose(origin: ClientTrackingOrigin): void {
    for (const entry of this._entries.values()) {
      const composed = composePlaceArMarker(entry.args, origin);
      placeMarker(entry.root, composed.position);
    }
  }

  public update(eye: vec3, deltaS: number): void {
    for (const entry of this._entries.values()) {
      if (!entry.visual) {
        const orb = new WorldMeshRenderer(entry.root, "WorldMarkerIndicator", requireAsset("../../../Materials/PoseIndicator.mat") as Material);
        const label = global.scene.createSceneObject("WorldMarkerLabel"); label.setParent(entry.root);
        label.getTransform().setLocalPosition(new vec3(0, 10, 0));
        const plate = createRoundedSurface(label, "WorldMarkerPlate", 38, 7.5, vec3.zero(), new vec4(0.08, 0.08, 0.09, 0), 3.75);
        const title = createText({ parent: label, name: "WorldMarkerTitle", fontSize: 44, color: COLOR_WHITE,
          position: new vec3(0, 1.2, 0.2), horizontalAlignment: HorizontalAlignment.Center,
          worldSpaceRect: Rect.create(-17, 17, -1.5, 1.5) });
        const caption = createText({ parent: label, name: "WorldMarkerCaption", text: "World marker", fontSize: 24,
          color: new vec4(0.68, 0.68, 0.7, 1), position: new vec3(0, -1.7, 0.2), horizontalAlignment: HorizontalAlignment.Center,
          worldSpaceRect: Rect.create(-17, 17, -1, 1) });
        entry.visual = { orb, label, title, caption, plate };
      }
      const visual = entry.visual;
      entry.progress = Math.min(1, entry.progress + Math.max(0, deltaS) / 0.18);
      const eased = entry.progress * entry.progress * (3 - 2 * entry.progress);
      entry.root.getTransform().setLocalScale(vec3.one().uniformScale(0.94 + 0.06 * eased));
      if (entry.lastOpacity !== eased) {
        visual.orb.triangles(MARKER_SPHERE.positions, MARKER_SPHERE.indices, [1, 1, 1, eased], undefined, MARKER_SPHERE.normals);
        entry.lastOpacity = eased;
      }
      visual.title.text = entry.args.title || "World marker";
      visual.title.textFill.color = new vec4(1, 1, 1, eased);
      visual.caption.textFill.color = new vec4(0.68, 0.68, 0.7, eased);
      visual.plate.backgroundColor = new vec4(0.08, 0.08, 0.09, 0.78 * eased);
      const direction = eye.sub(visual.label.getTransform().getWorldPosition());
      if (direction.length > 0.001) visual.label.getTransform().setWorldRotation(quat.lookAt(direction.normalize(), vec3.up()));
    }
  }

  public clearAll(): void {
    for (const id of [...this._entries.keys()]) {
      this.remove(id);
    }
  }

  public remove(id: string): void {
    const entry = this._entries.get(id);
    if (!entry) {
      return;
    }
    entry.root.destroy();
    this._entries.delete(id);
  }

  public size(): number {
    return this._entries.size;
  }
}

function placeMarker(root: SceneObject, trackingPosition: Vec3): void {
  const position = clientTrackingToSpecsPoint(trackingPosition);
  root.getTransform().setWorldPosition(toVec3(position));
  root.enabled = true;
}

function toVec3(value: Vec3): vec3 {
  return new vec3(value[0], value[1], value[2]);
}
