import type { AppState, NavigationState } from "../AppState";
import {
  defaultNavigationError,
  navigationErrorIsNone,
} from "../AppState";
import type { NavStatusMessage } from "../../ARBridge/Network/Protocol";
import {
  deriveMarkerViewState,
  deriveNavigationState,
  dragEnabledForState,
  idleAnchorEnabled,
  shouldRenderNavigationPath,
  type NavigationEvent,
  type NavigationInputs,
  type NavigationSession,
} from "../../ARBridge/Navigation/NavigationModel";
import type { GroundPlacement } from "./GroundPlacement";
import type { NavigationMarker } from "./NavigationMarker";
import type { NavigationPathRenderer } from "./NavigationPathRenderer";

// ================================================================
/** Presentation, AppState sync, and nav-status ingress planning for NavigationController. */
// ================================================================

export type NavStatusIngressPlan =
  | { kind: "dispatch"; event: NavigationEvent }
  | { kind: "continuePlacement" };

export function buildNavigationInputs(
  placement: GroundPlacement,
  marker: NavigationMarker | null,
  cancelAvailable: boolean,
): NavigationInputs {
  const markerPose = marker
    ? {
        position: placement.getCurrentPose()?.position ?? marker.worldPosition,
        rotation: placement.getCurrentPose()?.rotation ?? marker.getRotation(),
      }
    : null;
  return {
    placementActive: placement.isPlacementActive(),
    activelyDragging: placement.isActivelyDragging(),
    markerExists: marker !== null,
    markerPose,
    cancelAvailable,
  };
}

export function syncAppNavigationState(
  appState: AppState,
  navigationState: NavigationState,
): void {
  const current = appState.snapshot;
  if (navigationState === "navigating") {
    if (
      current.navigationState === navigationState &&
      navigationErrorIsNone(current.navigationError)
    ) {
      return;
    }
    appState.update({
      navigationError: defaultNavigationError(),
      navigationState,
    });
    return;
  }
  if (current.navigationState === navigationState) {
    return;
  }
  appState.update({ navigationState });
}

export type ApplyNavigationPresentationArgs = {
  placement: GroundPlacement;
  marker: NavigationMarker | null;
  pathRenderer: NavigationPathRenderer;
  bridgePath: vec3[] | null;
  session: NavigationSession;
  cancelAvailable: boolean;
  appState: AppState;
  robotFloorPosition: vec3 | null;
};

export function applyNavigationPresentation(args: ApplyNavigationPresentationArgs): void {
  const {
    placement,
    marker,
    pathRenderer,
    bridgePath,
    session,
    cancelAvailable,
    appState,
    robotFloorPosition,
  } = args;

  if (!session.navSessionActive) {
    return;
  }

  const inputs = buildNavigationInputs(placement, marker, cancelAvailable);
  const navigationState = deriveNavigationState(session, inputs);
  syncAppNavigationState(appState, navigationState);

  if (!marker) {
    return;
  }

  const markerView = deriveMarkerViewState(session, inputs, navigationState);
  if (markerView) {
    marker.apply(markerView);
  }

  placement.setIdleAnchor(idleAnchorEnabled(navigationState));
  placement.setDragEnabled(dragEnabledForState(navigationState));

  if (!shouldRenderNavigationPath(navigationState)) {
    pathRenderer.clear();
    return;
  }

  const goalPosition =
    placement.getRenderedPosition() ?? marker.worldPosition ?? null;
  if (!robotFloorPosition || !goalPosition) {
    pathRenderer.clear();
    return;
  }
  pathRenderer.setHeightRange(robotFloorPosition.y, goalPosition.y);

  if (!bridgePath || bridgePath.length < 2) {
    pathRenderer.clear();
    return;
  }
  pathRenderer.setLensPath(bridgePath);
}

export function planNavStatusEvent(
  session: NavigationSession,
  msg: NavStatusMessage,
  suppressTerminal: boolean,
): NavStatusIngressPlan {
  const navStatusEvent: NavigationEvent = {
    kind: "navStatus",
    state: msg.state,
    outcome: msg.outcome,
    retryable: msg.retryable,
    stall_reason: msg.stall_reason,
  };

  if (msg.state === "resolved") {
    if (session.goal === null) {
      return { kind: "dispatch", event: navStatusEvent };
    }
    if (
      (msg.outcome === "succeeded" || msg.outcome === "failed") &&
      suppressTerminal
    ) {
      return { kind: "continuePlacement" };
    }
  }

  return { kind: "dispatch", event: navStatusEvent };
}

export function shouldStreamGoalNow(
  session: NavigationSession,
  inputs: NavigationInputs,
): boolean {
  return (
    deriveNavigationState(session, inputs) === "navIntent" && inputs.placementActive
  );
}
