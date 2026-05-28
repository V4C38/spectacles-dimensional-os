export const LAYOUT_DIRTY = 1 << 0;
export const STATE_DIRTY = 1 << 1;

/**
 * Deferred dirty-flag update pattern (from Agent Center sample).
 */
export abstract class DirtyComponent extends BaseScriptComponent {
  private _dirtyFlags = 0;
  private _tracking = false;
  private _updateEvent: SceneEvent | null = null;

  private get _event(): SceneEvent {
    if (!this._updateEvent) {
      this._updateEvent = this.createEvent("UpdateEvent");
      this._updateEvent.bind(() => this._tick());
      this._updateEvent.enabled = false;
    }
    return this._updateEvent;
  }

  onAwake(): void {
    void this._event;
  }

  protected markDirty(flag: number = LAYOUT_DIRTY): void {
    this._dirtyFlags |= flag;
    this._event.enabled = true;
  }

  protected clearDirty(): void {
    this._dirtyFlags = 0;
    if (!this._tracking && this._updateEvent) {
      this._updateEvent.enabled = false;
    }
  }

  protected setTracking(on: boolean): void {
    this._tracking = on;
    this._event.enabled = on || this._dirtyFlags !== 0;
  }

  private _tick(): void {
    if (this._dirtyFlags !== 0) {
      const f = this._dirtyFlags;
      this._dirtyFlags = 0;
      this.onFlush(f);
    }
    if (this._tracking) {
      this.onTrack();
    }
    if (!this._tracking && this._dirtyFlags === 0 && this._updateEvent) {
      this._updateEvent.enabled = false;
    }
  }

  protected abstract onFlush(flags: number): void;

  protected onTrack(): void {}
}
