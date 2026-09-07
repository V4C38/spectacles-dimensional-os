import {
  buildGetStatus,
  BridgeStatusMessage,
  CapturePolicyMessage,
  HelloMessage,
  PongMessage,
} from "../Network/Protocol";
import { InboundProcessor } from "../Network/InboundProcessor";
import { sendForActiveRobot, WebSocketTransport } from "../Network/WebSocketTransport";
import { Signal } from "../../App/Utilities/Utilities";
import { ARBridgeSession } from "../Network/ARBridgeSession";

/** Hello, bridge_status, runtime_snapshot, get_status, ping — mirrors StatusService. */
export class StatusClient {
  public readonly onHello = new Signal<HelloMessage>();
  public readonly onBridgeStatus = new Signal<BridgeStatusMessage>();
  public readonly onCapturePolicy = new Signal<CapturePolicyMessage>();
  public readonly onPong = new Signal<PongMessage>();

  private readonly _sendDropLog = { value: -1 };
  private _bound = false;

  constructor(
    private readonly _session: ARBridgeSession | null,
    private readonly _transport: WebSocketTransport | null,
    private readonly _inbound: InboundProcessor | null,
  ) {}

  public bind(): void {
    if (this._bound || !this._inbound) {
      return;
    }
    this._bound = true;
    this._inbound.onHello.add((msg) => {
      this.onHello.emit(msg);
    });
    this._inbound.onBridgeStatus.add((msg) => this.onBridgeStatus.emit(msg));
    this._inbound.onCapturePolicy.add((msg) => this.onCapturePolicy.emit(msg));
    this._inbound.onPong.add((msg) => this.onPong.emit(msg));
  }

  public requestStatus(): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    return sendForActiveRobot(
      this._transport,
      this._inbound,
      "get_status",
      buildGetStatus,
      this._sendDropLog,
    );
  }
}
