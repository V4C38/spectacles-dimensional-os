import {
  AgentResponseMessage,
  AgentStatusMessage,
  ArSkillMessage,
  buildUserCommand,
  buildArSkillResult,
  ProtocolParseError,
} from "../Network/Protocol";
import { InboundProcessor } from "../Network/InboundProcessor";
import { sendForActiveRobot, WebSocketTransport } from "../Network/WebSocketTransport";
import { Signal } from "../../App/Utilities/Utilities";
import { ArSkillHandlers } from "./ArSkillHandlers";

/** Agent wire I/O — conversation relay and deferred AR skill execution. */
export class AgentClient {
  public readonly onAgentResponse = new Signal<AgentResponseMessage>();
  public readonly onAgentStatus = new Signal<AgentStatusMessage>();
  public readonly onArSkill = new Signal<ArSkillMessage>();
  public readonly onProtocolError = new Signal<ProtocolParseError>();

  private readonly _skillHandlers = new ArSkillHandlers();
  private readonly _sendDropLog = { value: -1 };
  private _bound = false;

  constructor(
    private readonly _eventHost: ScriptComponent,
    private readonly _transport: WebSocketTransport | null,
    private readonly _inbound: InboundProcessor | null,
  ) {}

  public bind(): void {
    if (this._bound || !this._inbound) {
      return;
    }
    this._bound = true;
    this._inbound.onAgentResponse.add((msg) => this.onAgentResponse.emit(msg));
    this._inbound.onAgentStatus.add((msg) => this.onAgentStatus.emit(msg));
    this._inbound.onArSkill.add((msg) => this._scheduleArSkill(msg));
    this._inbound.onProtocolError.add((error) => this.onProtocolError.emit(error));
  }

  public sendUserCommand(text: string): boolean {
    if (!this._transport || !this._inbound) {
      return false;
    }
    return sendForActiveRobot(
      this._transport,
      this._inbound,
      "user_command",
      (robotId) => buildUserCommand(robotId, text),
      this._sendDropLog,
    );
  }

  private _scheduleArSkill(msg: ArSkillMessage): void {
    const deferred = this._eventHost.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    deferred.reset(0);
    deferred.bind(() => this._handleArSkill(msg));
  }

  private _handleArSkill(msg: ArSkillMessage): void {
    const result = this._skillHandlers.handle(msg);
    if (!this._transport || !this._inbound) {
      return;
    }
    sendForActiveRobot(
      this._transport,
      this._inbound,
      "ar_skill_result",
      (robotId) =>
        buildArSkillResult({
          robotId,
          requestId: msg.request_id,
          ok: result.ok,
          skill: msg.skill,
          data: result.data,
          error: result.error,
        }),
      this._sendDropLog,
    );
  }
}
