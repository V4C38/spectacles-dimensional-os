import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { BridgeClient } from "../Network/BridgeClient";
import { DimosManager } from "../DimosManager";

export interface WizardConnectionCallbacks {
  onConnecting: (ip: string) => void;
  onConnected: (ip: string) => void;
  onRetrying: (ip: string) => void;
}

export class WizardConnectionController {
  private _operationId = 0;

  constructor(
    private readonly _owner: BaseScriptComponent,
    private readonly _dimosManager: DimosManager,
    private readonly _isConnectStepActive: () => boolean,
    private readonly _log: (message: string) => void,
  ) {}

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
    const retry = this._owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;

    retry.bind(() => {
      if (opId !== this._operationId || !this._isConnectStepActive()) {
        return;
      }

      this._dimosManager.setBaseUrl(ip);
      this._dimosManager.checkConnection().then((ok) => {
        this._handleConnectionResult(opId, ip, ok, callbacks);
      });
    });

    retry.reset(2.0);
  }
}
