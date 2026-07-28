import { describe, expect, it, vi, beforeEach } from "vitest";
import { InboundProcessor } from "../../Assets/Scripts/ARBridge/Network/InboundProcessor";
import { Signal } from "../../Assets/Scripts/App/Utilities/Utilities";
import type { PendingBinaryFrame } from "../../Assets/Scripts/ARBridge/Network/WebSocketTransport";
import type {
  AgentStatusMessage,
  NavStatusMessage,
} from "../../Assets/Scripts/ARBridge/Network/Protocol";

function makeProcessor() {
  const connection = {
    onTextMessage: new Signal<string>(),
    onBinaryBlob: new Signal<PendingBinaryFrame>(),
    onClose: new Signal<void>(),
    isSocketOpen: () => true,
  };
  const script = {
    createEvent: vi.fn(() => ({
      bind: vi.fn(),
      reset: vi.fn(),
    })),
  };
  const callbacks = {
    onHelloConnection: vi.fn(),
    onSocketClosed: vi.fn(),
    scheduleParseRecoveryReconnect: vi.fn(),
  };
  const processor = new InboundProcessor(
    script as unknown as ScriptComponent,
    connection as never,
    callbacks,
  );
  return { processor, connection };
}

describe("InboundProcessor runtime_snapshot emit", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).print = vi.fn();
    (globalThis as Record<string, unknown>).getTime = vi.fn(() => 0);
  });

  it("emits synthetic nav_status with goal and agent_status from snapshot", () => {
    const { processor, connection } = makeProcessor();
    const navStatuses: NavStatusMessage[] = [];
    const agentStatuses: AgentStatusMessage[] = [];
    processor.onNavStatus.add((msg) => navStatuses.push(msg));
    processor.onAgentStatus.add((msg) => agentStatuses.push(msg));

    connection.onTextMessage.emit(
      JSON.stringify({
        type: "runtime_snapshot",
        ts: 12,
        robot_id: "go2",
        bridge: {
          robot_connected: true,
          world_frame_committed: true,
          reconnecting: false,
          world_frame_method: "manual_pose",
          world_frame_approximate: false,
        },
        nav: {
          state: "navigating",
          goal: {
            source: "agent",
            position: [1, 0, 2],
            orientation: [0, 0, 0, 1],
          },
        },
        agent: { state: "busy", detail: "planning route" },
      }),
    );

    expect(navStatuses).toHaveLength(1);
    expect(navStatuses[0]).toMatchObject({
      type: "nav_status",
      ts: 12,
      state: "navigating",
      goal: {
        source: "agent",
        position: [1, 0, 2],
        orientation: [0, 0, 0, 1],
      },
    });
    expect(agentStatuses).toEqual([
      {
        type: "agent_status",
        ts: 12,
        state: "busy",
        detail: "planning route",
      },
    ]);
  });
});
