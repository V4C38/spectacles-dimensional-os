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
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {
  isLatestAnimationVersion,
  nextAnimationVersion,
} from "../Utilities/AnimationUtilities";
import type { GroundPlacement, MeshBlockReason } from "./GroundPlacement";
import type { NavigationMarker } from "./NavigationMarker";
import type { NavigationPathRenderer } from "./NavigationPathRenderer";

const OPACITY_VERSION_KEY = "__worldMeshHintOpacityVersion";
const FADE_IN_S = 0.2;
const FADE_OUT_S = 0.2;
const TINT_UNSCANNED = new vec4(1, 0.576, 0, 1);
const TINT_WALL = new vec4(1, 0.2, 0.2, 1);

export type WorldMeshHintState = {
  blockReason: MeshBlockReason;
  visible: boolean;
};

export function createWorldMeshHintState(): WorldMeshHintState {
  return { blockReason: "none", visible: false };
}

function applyWorldMeshHint(
  state: WorldMeshHintState,
  worldMeshObject: SceneObject,
  pass: any,
  blockReason: MeshBlockReason,
  highlightWorldPos: vec3,
): void {
  const blocked = blockReason !== "none";
  const wasBlocked = state.blockReason !== "none";
  state.blockReason = blockReason;

  if (blocked) {
    pass.HighlightLocationWS = highlightWorldPos;
    pass.TintColor = blockReason === "wall" ? TINT_WALL : TINT_UNSCANNED;
    if (!wasBlocked) {
      fadeWorldMeshHintOpacity(state, worldMeshObject, pass, 1, FADE_IN_S, true);
    } else if (state.visible) {
      worldMeshObject.enabled = true;
    }
    return;
  }

  if (wasBlocked || state.visible) {
    fadeWorldMeshHintOpacity(state, worldMeshObject, pass, 0, FADE_OUT_S, false);
  }
}

export function resetWorldMeshHint(
  state: WorldMeshHintState,
  worldMeshObject: SceneObject,
  pass: any,
): void {
  nextAnimationVersion(state, OPACITY_VERSION_KEY);
  state.blockReason = "none";
  state.visible = false;
  worldMeshObject.enabled = false;
  pass.Opacity = 0;
}

function fadeWorldMeshHintOpacity(
  state: WorldMeshHintState,
  worldMeshObject: SceneObject,
  pass: any,
  targetOpacity: number,
  duration: number,
  enableOnStart: boolean,
): void {
  const version = nextAnimationVersion(state, OPACITY_VERSION_KEY);
  const startOpacity = pass.Opacity ?? 0;
  if (enableOnStart) {
    worldMeshObject.enabled = true;
  }
  animate({
    duration,
    easing: "ease-in-out-quad",
    update: (t: number) => {
      if (!isLatestAnimationVersion(state, OPACITY_VERSION_KEY, version)) {
        return;
      }
      pass.Opacity = startOpacity + (targetOpacity - startOpacity) * t;
    },
    ended: () => {
      if (!isLatestAnimationVersion(state, OPACITY_VERSION_KEY, version)) {
        return;
      }
      pass.Opacity = targetOpacity;
      state.visible = targetOpacity > 0;
      if (targetOpacity <= 0) {
        worldMeshObject.enabled = false;
      }
    },
  });
}

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
  worldMeshObject: SceneObject;
  worldMeshVisual: RenderMeshVisual;
  worldMeshHintState: WorldMeshHintState;
  placementBlockReason: MeshBlockReason;
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
    worldMeshObject,
    worldMeshVisual,
    worldMeshHintState,
    placementBlockReason,
  } = args;

  if (!session.navSessionActive) {
    resetWorldMeshHint(
      worldMeshHintState,
      worldMeshObject,
      worldMeshVisual.mainMaterial.mainPass as any,
    );
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

  if (inputs.activelyDragging) {
    applyWorldMeshHint(
      worldMeshHintState,
      worldMeshObject,
      worldMeshVisual.mainMaterial.mainPass as any,
      placementBlockReason,
      placement.getRenderedPosition(),
    );
  } else {
    applyWorldMeshHint(
      worldMeshHintState,
      worldMeshObject,
      worldMeshVisual.mainMaterial.mainPass as any,
      "none",
      vec3.zero(),
    );
  }

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
