import {
  buildEmergencyStop,
  buildNavigateGoal,
  NavStatusMessage,
  PathMessage,
  ProtocolParseError,
} from "../Network/Protocol";
import { InboundProcessor } from "../Network/InboundProcessor";
import { WebSocketTransport } from "../Network/WebSocketTransport";
import { sendForActiveRobot } from "../Network/WebSocketTransport";
import { Signal } from "../../App/Utilities/Utilities";

/** Navigate/e-stop wire I/O — mirrors NavigateGoalHandler. */
export class NavigationClient {
  public readonly onPath = new Signal<PathMessage>();
  public readonly onNavStatus = new Signal<NavStatusMessage>();
  public readonly onProtocolError = new Signal<ProtocolParseError>();

  private readonly _sendDropLog = { value: -1 };
  private _bound = false;

  constructor(
    private readonly _transport: WebSocketTransport | null,
    private readonly _inbound: InboundProcessor | null,
  ) {}

  public bind(): void {
    if (this._bound || !this._inbound) {
      return;
    }
    this._bound = true;
    this._inbound.onPath.add((msg) => this.onPath.emit(msg));
    this._inbound.onNavStatus.add((msg) => this.onNavStatus.emit(msg));
    this._inbound.onProtocolError.add((error) => this.onProtocolError.emit(error));
  }

  public sendNavGoal(position: vec3, rotation: quat): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    return sendForActiveRobot(
      this._transport,
      this._inbound,
      "nav_goal:navigate",
      (robotId) => buildNavigateGoal(robotId, position, rotation),
      this._sendDropLog,
    );
  }

  public sendEmergencyStop(): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    return sendForActiveRobot(
      this._transport,
      this._inbound,
      "emergency_stop",
      buildEmergencyStop,
      this._sendDropLog,
    );
  }
}
