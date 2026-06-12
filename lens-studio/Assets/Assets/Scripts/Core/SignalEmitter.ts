/**
 * Type-safe event emitter that replaces parallel callback arrays + ensureEventHandlers.
 *
 * Lazy listener array (initialized on first add/emit) is init-order safe under
 * Lens Studio's component-initialization model: a getter-backed null field avoids
 * relying on class-field initializers running before another script calls add().
 *
 * slice() before iteration preserves the waitForHello self-removal semantics and
 * protects against listeners that add/remove during dispatch.
 *
 * Per-listener try/catch matches the isolation rationale in R-1: a throwing listener
 * already produced broken behavior; catching it preserves remaining listeners.
 */
export class Signal<T> {
  private _listeners: ((value: T) => void)[] | null = null;

  private get _list(): ((value: T) => void)[] {
    if (!this._listeners) {
      this._listeners = [];
    }
    return this._listeners;
  }

  /** Subscribe to the signal. Returns an unsubscribe function. */
  public add(listener: (value: T) => void): () => void {
    this._list.push(listener);
    return () => {
      if (!this._listeners) {
        return;
      }
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) {
        this._listeners.splice(idx, 1);
      }
    };
  }

  /** Emit a value to all current listeners (snapshot-before-iterate). */
  public emit(value: T): void {
    if (!this._listeners || this._listeners.length === 0) {
      return;
    }
    for (const listener of this._listeners.slice()) {
      try {
        listener(value);
      } catch (e) {
        print(`Signal listener error: ${e}`);
      }
    }
  }
}
