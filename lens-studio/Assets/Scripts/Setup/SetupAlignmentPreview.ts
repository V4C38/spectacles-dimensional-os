import { AlignStatusMessage } from "../Bridge/Protocol";
import { AlignmentSession } from "../Alignment/AlignmentSession";
import { DimosState } from "../Core/DimosState";
import { OperatingMode } from "../Core/AppState";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { robotFloorWorldYCm } from "../Robot/RobotRuntimeModel";
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

/** Setup calibration assist preview (marker, ground disc, robot menu). */
export class SetupAlignmentPreview {
  private _active = false;

  constructor(
    private readonly dimosState: DimosState,
    private readonly discPrefab: ObjectPrefab | null,
    private readonly spawnParent: SceneObject,
    private readonly robotRuntime: RobotRuntime,
    private readonly alignmentSession: AlignmentSession,
  ) {}
  private _tagVisible = false;
  private _discInstance: SceneObject | null = null;
  private _discAnchorInitialized = false;
  private _discLeftArrow: SceneObject | null = null;
  private _discRightArrow: SceneObject | null = null;
  private _moveLeg = -1;
  private _priorRuntimeMode: OperatingMode = "manual";

  public begin(): void {
    this._priorRuntimeMode = this.dimosState.snapshot.operatingMode !== "setup"
      ? this.dimosState.snapshot.operatingMode
      : "manual";
    this.dimosState.update({ operatingMode: "setup", lidarMode: "off" });

    this._active = true;
    this._tagVisible = false;
    const ui = this.robotRuntime?.robotMarker?.ui;
    ui?.setOnContinue(() => this.alignmentSession?.confirmAssist());
    this._resetVisualState();
    this.robotRuntime?.robotMarker?.setVisible(false);
    ui?.setMenuVisible(false);
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
    const ui = this.robotRuntime?.robotMarker?.ui;
    const wasMenuVisible = ui?.isMenuVisible() ?? false;
    const marker = this.robotRuntime?.robotMarker;

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
        ui?.setMenuVisible(true);
      }
    } else {
      marker?.setVisible(false);
      this._updateDiscPreview(null, assistStage, progress);
    }

    const inMove = isAssistMoveStage(assistStage);
    if (previewStageActive) {
      const presentation = buildAssistPreviewPresentation({
        assistStage,
        progress,
        tagVisible: this._tagVisible,
      });
      ui?.applyAssistOverlay({
        titleText: presentation.titleText,
        statusText: presentation.statusText,
        statusColor: presentation.statusColor,
        showWizardMenu: assistStage === "awaiting_confirm",
        showContinue: assistStage === "awaiting_confirm",
        showStop: inMove,
      });
    }
  }

  public setComplete(): void {
    if (!this._active) {
      return;
    }
    const GREEN = new vec4(0.2, 0.8, 0.2, 1);
    this._setDiscArrowVisibility(null);
    this.robotRuntime?.robotMarker?.ui?.applyAssistOverlay({
      titleText: "Alignment complete",
      statusText: "Alignment complete",
      statusColor: GREEN,
      showWizardMenu: false,
      showContinue: false,
      showStop: false,
    });
  }

  public end(): void {
    if (!this._active) {
      return;
    }
    this._active = false;
    this._resetVisualState();
    this.robotRuntime?.robotMarker?.setVisible(false);
    const ui = this.robotRuntime?.robotMarker?.ui;
    ui?.setOnContinue(null);
    ui?.applyAssistOverlay({
      titleText: "",
      statusText: "",
      statusColor: COLOR_SUCCESS,
      showWizardMenu: false,
      showContinue: false,
      showStop: false,
    });
    ui?.setMenuVisible(false);

    const prior = this._priorRuntimeMode;
    const lidarMode = prior === "manual" ? "obstacles" : "off";
    this.dimosState.update({ operatingMode: prior, lidarMode });
  }

  public endIfActive(): void {
    if (this._active) {
      this.end();
    }
  }

  public get isActive(): boolean {
    return this._active;
  }

  private _updateDiscPreview(
    worldPosition: vec3 | null,
    assistStage: string | undefined,
    progress: number,
  ): void {
    if (!isAssistPreviewStage(assistStage)) {
      this._resetVisualState();
      return;
    }

    const disc = this._ensureDisc();
    if (!disc) {
      return;
    }

    if (!this._discAnchorInitialized && worldPosition) {
      const floorY = robotFloorWorldYCm(
        worldPosition.y,
        this.dimosState.snapshot.robotRuntime,
      );
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

  private _ensureDisc(): SceneObject | null {
    if (!this.discPrefab) {
      return null;
    }
    if (!this._discInstance) {
      this._discInstance = this.discPrefab.instantiate(this.spawnParent);
      this._discInstance.enabled = false;
      this._ensureDiscChildren(this._discInstance);
    }
    return this._discInstance;
  }

  private _destroyDisc(): void {
    if (!this._discInstance) {
      return;
    }
    this._discInstance.destroy();
    this._discInstance = null;
    this._discLeftArrow = null;
    this._discRightArrow = null;
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
    this._destroyDisc();
    this._setDiscArrowVisibility(null);
  }
}
