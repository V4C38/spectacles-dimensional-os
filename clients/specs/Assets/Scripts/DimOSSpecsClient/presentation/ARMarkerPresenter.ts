import {
  composePlaceArMarker,
  type PlaceArMarkerArgs,
} from "../../DimOSARClient/agent/agentSkills";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { clientTrackingToSpecsPoint } from "../utilities/SpecsCoordinates";
import { findText } from "./UIKit";

export interface ARMarkerPresenterDeps {
  parent: SceneObject;
  markerPrefab: ObjectPrefab | null;
}

type MarkerEntry = {
  root: SceneObject;
  args: PlaceArMarkerArgs;
};

/** Owns world-anchored ar_place_marker visuals in the Specs tracking frame. */
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
      applyVisual(existing.root, composed.position, composed.title);
      return { ok: true };
    }
    const root = this._markerPrefab.instantiate(this._parent);
    applyVisual(root, composed.position, composed.title);
    this._entries.set(args.id, { root, args });
    return { ok: true };
  }

  public recompose(origin: ClientTrackingOrigin): void {
    for (const entry of this._entries.values()) {
      const composed = composePlaceArMarker(entry.args, origin);
      applyVisual(entry.root, composed.position, composed.title);
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

function applyVisual(root: SceneObject, trackingPosition: Vec3, title: string): void {
  const position = clientTrackingToSpecsPoint(trackingPosition);
  root.getTransform().setWorldPosition(toVec3(position));
  const text = findText(root, "ObjectName") ?? findFirstTextFallback(root);
  if (text) {
    text.text = title;
  }
  root.enabled = true;
}

function toVec3(value: Vec3): vec3 {
  return new vec3(value[0], value[1], value[2]);
}

function findFirstTextFallback(root: SceneObject): Text | null {
  const direct = root.getComponent("Component.Text") as Text | null;
  if (direct) {
    return direct;
  }
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const nested = findFirstTextFallback(root.getChild(i));
    if (nested) {
      return nested;
    }
  }
  return null;
}
