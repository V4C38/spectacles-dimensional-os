import { odomToClientTrackingPoint } from "../localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { Vec3 } from "../websocket/protocolTypes";

export const MARKER_ID_MAX_LEN = 64;

export interface PlaceArMarkerArgs {
  id: string;
  x: number;
  y: number;
  z: number;
  title: string;
}

export interface RemoveArMarkerArgs {
  id: string;
}

export interface ComposedPlaceArMarker {
  position: Vec3;
  title: string;
}

export function parsePlaceArMarkerArgs(args: Record<string, unknown>): PlaceArMarkerArgs {
  return {
    id: requireMarkerId(args.id, "ar_place_marker.id"),
    x: requireFiniteNumber(args.x, "ar_place_marker.x"),
    y: requireFiniteNumber(args.y, "ar_place_marker.y"),
    z: requireFiniteNumber(args.z, "ar_place_marker.z"),
    title: requireTitle(args.title, "ar_place_marker.title"),
  };
}

export function parseRemoveArMarkerArgs(args: Record<string, unknown>): RemoveArMarkerArgs {
  return { id: requireMarkerId(args.id, "ar_remove_marker.id") };
}

export function composePlaceArMarker(
  args: PlaceArMarkerArgs,
  origin: ClientTrackingOrigin,
): ComposedPlaceArMarker {
  return {
    position: odomToClientTrackingPoint([args.x, args.y, args.z], origin),
    title: args.title,
  };
}

function requireMarkerId(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} is blank`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is blank`);
  }
  if (trimmed.length > MARKER_ID_MAX_LEN) {
    throw new Error(`${field} is too long`);
  }
  return trimmed;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function requireTitle(value: unknown, field: string): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}
