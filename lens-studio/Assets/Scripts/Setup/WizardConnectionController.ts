import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { BridgeClient } from "../Network/BridgeClient";
import { DimosManager } from "../DimosManager";

// ================================================================
/** Autoconnect and retry logic for bridge IP entry during the connect step. */
// ================================================================

export interface WizardConnectionCallbacks {
  onConnecting: (ip: string) => void;
  onConnected: (ip: string) => void;
  onRetrying: (ip: string) => void;
}

export class WizardConnectionController {
  private _operationId = 0;

  // BUG-2: cached retry event (created once in constructor, re-armed per retry).
  private readonly _retryEvent: DelayedCallbackEvent;
  private _pendingRetryOpId = 0;
  private _pendingRetryIp = "";
  private _pendingRetryCallbacks: WizardConnectionCallbacks | null = null;

  constructor(
    private readonly _owner: BaseScriptComponent,
    private readonly _dimosManager: DimosManager,
    private readonly _isConnectStepActive: () => boolean,
    private readonly _log: (message: string) => void,
  ) {
    const retryEv = this._owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    retryEv.bind(() => {
      if (
        this._pendingRetryOpId !== this._operationId ||
        !this._isConnectStepActive()
      ) {
        return;
      }
      this._dimosManager.setBaseUrl(this._pendingRetryIp);
      this._dimosManager.checkConnection().then((ok) => {
        this._handleConnectionResult(
          this._pendingRetryOpId,
          this._pendingRetryIp,
          ok,
          this._pendingRetryCallbacks!,
        );
      });
    });
    this._retryEvent = retryEv;
  }

  public invalidatePending(): void {
    this._operationId++;
  }

  public cancel(reason: string, disconnect: boolean = false): void {
    this.invalidatePending();
    if (disconnect) {
      this._dimosManager.disconnect();
    }
    this._log(reason);
  }

  public startAutoconnect(
    inputField: TextInputField | null,
    callbacks: WizardConnectionCallbacks,
  ): void {
    if (!this._isConnectStepActive() || !inputField) {
      return;
    }

    const raw = inputField.text.trim();
    if (!raw) {
      return;
    }

    const ip = BridgeClient.normalizeIp(raw);
    if (ip !== raw) {
      inputField.text = ip;
    }

    this.invalidatePending();
    const opId = this._operationId;
    this._dimosManager.setBaseUrl(ip);
    callbacks.onConnecting(ip);
    this._log(`connect attempt ${ip}`);

    this._dimosManager.checkConnection().then((ok) => {
      this._handleConnectionResult(opId, ip, ok, callbacks);
    });
  }

  private _handleConnectionResult(
    opId: number,
    ip: string,
    ok: boolean,
    callbacks: WizardConnectionCallbacks,
  ): void {
    if (opId !== this._operationId || !this._isConnectStepActive()) {
      return;
    }

    if (ok) {
      this._dimosManager.saveIp(ip);
      callbacks.onConnected(ip);
      this._log("connect succeeded");
      return;
    }

    callbacks.onRetrying(ip);
    this._log("connect failed, retrying");
    this._scheduleRetry(opId, ip, callbacks);
  }

  private _scheduleRetry(
    opId: number,
    ip: string,
    callbacks: WizardConnectionCallbacks,
  ): void {
    // BUG-2: rearm the single cached retry event (no new event object per retry).
    this._pendingRetryOpId = opId;
    this._pendingRetryIp = ip;
    this._pendingRetryCallbacks = callbacks;
    this._retryEvent.reset(2.0);
  }
}
