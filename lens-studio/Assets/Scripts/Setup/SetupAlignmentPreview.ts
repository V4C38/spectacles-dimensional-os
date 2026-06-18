import { AlignStatusMessage } from "../Bridge/Protocol";
import { RobotMarker } from "../Robot/RobotMarker";
import { RobotMenuView } from "../Robot/RobotMenuView";
import { robotFloorWorldYCm, RobotRuntimeState } from "../Core/AppState";
import { COLOR_ERROR, COLOR_SUCCESS, findChildRecursive } from "../UI/kit/UIKit";

// ── Assist preview presentation ────────────────────────────────

export interface AssistPreviewPresentation {
  progress: number;
  titleText: string;
  statusText: string;
  statusColor: vec4;
}

export interface AssistPreviewInput {
  assistStage?: string;
  progress: number;
  tagVisible: boolean;
}

const AWAITING_CONFIRM_PROGRESS = 20;
const MOVE_LEG_ONE_PROGRESS = 17;
const MOVE_LEG_TWO_PROGRESS = 50;
const MOVE_LEG_THREE_PROGRESS = 83;

export function isAssistPreviewStage(assistStage?: string): boolean {
  return assistStage === "awaiting_confirm" || assistStage === "move";
}

export function isAssistMoveStage(assistStage?: string): boolean {
  return assistStage === "move";
}

export function buildAssistPreviewPresentation(
  input: AssistPreviewInput,
): AssistPreviewPresentation {
  const progress = computeAssistPreviewProgress(input);
  return {
    progress,
    titleText: `Progress: ${progress}%`,
    statusText: input.tagVisible ? "✅ Tag visible" : "❌ Tag not visible - Look at the tag",
    statusColor: input.tagVisible ? COLOR_SUCCESS : COLOR_ERROR,
  };
}

export function computeAssistPreviewProgress(input: AssistPreviewInput): number {
  const clamped = Math.max(0, Math.min(100, Math.round(input.progress)));
  if (input.assistStage === "awaiting_confirm") {
    return Math.max(clamped, AWAITING_CONFIRM_PROGRESS);
  }
  if (input.assistStage === "move") {
    if (clamped >= 100) {
      return 100;
    }
    if (clamped >= 66) {
      return Math.max(clamped, MOVE_LEG_THREE_PROGRESS);
    }
    if (clamped >= 33) {
      return Math.max(clamped, MOVE_LEG_TWO_PROGRESS);
    }
    return Math.max(clamped, MOVE_LEG_ONE_PROGRESS);
  }
  return clamped;
}

// ── Setup alignment preview ────────────────────────────────────

export interface SetupAlignmentPreviewDeps {
  groundDisc: SceneObject | null;
  robotMarker: RobotMarker | null;
  robotMenuView: RobotMenuView | null;
  getRobotRuntime: () => RobotRuntimeState;
  onConfirmAssist: () => void;
}

/** Setup calibration preview (marker, ground disc, robot menu). */
export class SetupAlignmentPreview {
  private _deps: SetupAlignmentPreviewDeps | null = null;
  private _active = false;
  private _tagVisible = false;
  private _discAnchorInitialized = false;
  private _discLeftArrow: SceneObject | null = null;
  private _discRightArrow: SceneObject | null = null;
  private _moveLeg = -1;

  public initialize(deps: SetupAlignmentPreviewDeps): void {
    this._deps = deps;
  }

  public begin(): void {
    this._active = true;
    this._tagVisible = false;
    const menu = this._deps?.robotMenuView;
    if (menu) {
      menu.onContinueRequested = () => this._deps?.onConfirmAssist();
    }
    this._resetVisualState();
    this._deps?.robotMarker?.setVisible(false);
    menu?.setMenuVisible(false);
  }

  public updateFromAlignStatus(msg: AlignStatusMessage): void {
    if (!this._active) {
      return;
    }
    this._tagVisible = msg.tag_visible ?? this._tagVisible;
    const assistStage = msg.assist_stage;
    const progress = msg.progress ?? 0;
    const worldPose = msg.robot_world_pose ?? null;
    const previewStageActive = isAssistPreviewStage(assistStage);
    const showMarker = previewStageActive && !!worldPose;
    const menu = this._deps?.robotMenuView;
    const wasMenuVisible = menu?.isMenuVisible() ?? false;
    const marker = this._deps?.robotMarker;

    if (showMarker && worldPose) {
      const pos = new vec3(
        worldPose.position[0] * 100,
        worldPose.position[1] * 100,
        worldPose.position[2] * 100,
      );
      const rot = new quat(
        worldPose.orientation[3],
        worldPose.orientation[0],
        worldPose.orientation[1],
        worldPose.orientation[2],
      );
      marker?.setVisible(true);
      marker?.applyRuntimeLensPose(pos, rot);
      this._updateDiscPreview(pos, assistStage, progress);
      if (!wasMenuVisible) {
        menu?.setMenuVisible(true);
      }
    } else {
      marker?.setVisible(false);
      this._updateDiscPreview(null, assistStage, progress);
    }

    const inMove = isAssistMoveStage(assistStage);
    menu?.setSetupWizardMenuVisible(assistStage === "awaiting_confirm");
    menu?.setContinueVisible(assistStage === "awaiting_confirm");
    menu?.setSetupStopVisible(inMove);
    if (previewStageActive) {
      const presentation = buildAssistPreviewPresentation({
        assistStage,
        progress,
        tagVisible: this._tagVisible,
      });
      menu?.setSetupTitle(presentation.titleText);
      menu?.setSetupStatus(presentation.statusText, presentation.statusColor);
    }
  }

  public setComplete(): void {
    if (!this._active) {
      return;
    }
    const GREEN = new vec4(0.2, 0.8, 0.2, 1);
    this._setDiscArrowVisibility(null);
    const menu = this._deps?.robotMenuView;
    menu?.setSetupTitle("Alignment complete");
    menu?.setSetupStatus("Alignment complete", GREEN);
    menu?.setContinueVisible(false);
    menu?.setSetupStopVisible(false);
  }

  public end(): void {
    if (!this._active) {
      return;
    }
    this._active = false;
    this._resetVisualState();
    this._deps?.robotMarker?.setVisible(false);
    const menu = this._deps?.robotMenuView;
    if (menu) {
      menu.onContinueRequested = null;
    }
    menu?.setMenuVisible(false);
  }

  public get isActive(): boolean {
    return this._active;
  }

  private _updateDiscPreview(
    worldPosition: vec3 | null,
    assistStage: string | undefined,
    progress: number,
  ): void {
    const disc = this._deps?.groundDisc ?? null;
    if (!disc) {
      return;
    }
    this._ensureDiscChildren(disc);

    if (!isAssistPreviewStage(assistStage)) {
      this._resetVisualState();
      return;
    }

    const runtime = this._deps?.getRobotRuntime() ?? ({} as RobotRuntimeState);
    if (!this._discAnchorInitialized && worldPosition) {
      const floorY = robotFloorWorldYCm(worldPosition.y, runtime);
      disc.getTransform().setWorldPosition(
        new vec3(worldPosition.x, floorY, worldPosition.z),
      );
      this._discAnchorInitialized = true;
    }

    disc.enabled = this._discAnchorInitialized;
    if (!this._discAnchorInitialized) {
      this._setDiscArrowVisibility(null);
      return;
    }

    if (!isAssistMoveStage(assistStage)) {
      this._moveLeg = -1;
      this._setDiscArrowVisibility(null);
      return;
    }

    const moveLeg = progress >= 66 ? 2 : progress >= 33 ? 1 : 0;
    if (moveLeg !== this._moveLeg) {
      this._moveLeg = moveLeg;
    }
    this._setDiscArrowVisibility(moveLeg);
  }

  private _ensureDiscChildren(disc: SceneObject): void {
    if (!this._discLeftArrow) {
      this._discLeftArrow = findChildRecursive(disc, "MoveDirectionArrow_Left");
    }
    if (!this._discRightArrow) {
      this._discRightArrow = findChildRecursive(disc, "MoveDirectionArrow_Right");
    }
    this._setDiscArrowVisibility(null);
  }

  private _setDiscArrowVisibility(moveLeg: number | null): void {
    if (this._discLeftArrow) {
      this._discLeftArrow.enabled = moveLeg === 0 || moveLeg === 2;
    }
    if (this._discRightArrow) {
      this._discRightArrow.enabled = moveLeg === 1;
    }
  }

  private _resetVisualState(): void {
    this._discAnchorInitialized = false;
    this._moveLeg = -1;
    const disc = this._deps?.groundDisc ?? null;
    if (disc) {
      disc.enabled = false;
    }
    this._setDiscArrowVisibility(null);
  }
}
