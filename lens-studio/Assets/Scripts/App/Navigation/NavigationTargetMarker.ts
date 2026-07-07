import { NavigationMarker, NavigationMarkerEvents } from "./NavigationMarker";

export type { NavigationMarkerEvents };

/** Prefab compatibility — delegates to NavigationMarker. */
@component
export class NavigationTargetMarker extends NavigationMarker {}
