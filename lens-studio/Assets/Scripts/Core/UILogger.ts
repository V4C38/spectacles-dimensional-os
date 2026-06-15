export interface UILogEntry {
  text: string;
  color: vec4;
  expiresAt: number | null;
}

export type UILogListener = (entry: UILogEntry | null) => void;

function cloneColor(color: vec4): vec4 {
  return new vec4(color.x, color.y, color.z, color.w);
}

function cloneEntry(entry: UILogEntry | null): UILogEntry | null {
  if (!entry) {
    return null;
  }
  return {
    text: entry.text,
    color: cloneColor(entry.color),
    expiresAt: entry.expiresAt,
  };
}

/** Shared transient UI log bus with immediate subscriptions and expiry support. */
export class UILogger {
  private readonly _listeners: UILogListener[] = [];
  private _dispatching = false;
  private _pendingEntries: (UILogEntry | null)[] = [];
  private _entry: UILogEntry | null = null;

  public get snapshot(): UILogEntry | null {
    return cloneEntry(this._entry);
  }

  public show(text: string, color: vec4, durationSecs: number | null = null): void {
    const expiresAt =
      durationSecs !== null && durationSecs > 0 ? getTime() + durationSecs : null;
    this._setEntry({
      text,
      color: cloneColor(color),
      expiresAt,
    });
  }

  public clear(): void {
    if (!this._entry) {
      return;
    }
    this._setEntry(null);
  }

  public tick(now: number = getTime()): void {
    if (!this._entry || this._entry.expiresAt === null || now < this._entry.expiresAt) {
      return;
    }
    this._setEntry(null);
  }

  public subscribe(listener: UILogListener): () => void {
    this._listeners.push(listener);
    listener(this.snapshot);
    return () => {
      const index = this._listeners.indexOf(listener);
      if (index >= 0) {
        this._listeners.splice(index, 1);
      }
    };
  }

  private _setEntry(entry: UILogEntry | null): void {
    const nextEntry = cloneEntry(entry);
    if (this._dispatching) {
      this._pendingEntries.push(nextEntry);
      return;
    }
    this._entry = nextEntry;
    this._dispatching = true;
    try {
      const snapshot = this.snapshot;
      for (const listener of this._listeners.slice()) {
        try {
          listener(snapshot);
        } catch (e) {
          print(`UILogger listener error: ${e}`);
        }
      }
    } finally {
      this._dispatching = false;
    }
    while (this._pendingEntries.length > 0) {
      const queued = this._pendingEntries.splice(0);
      for (const pending of queued) {
        this._setEntry(pending);
      }
    }
  }
}
