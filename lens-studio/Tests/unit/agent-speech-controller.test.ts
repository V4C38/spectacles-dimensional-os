import { describe, it, expect } from "vitest";
import {
  AppStateStore,
  createDefaultAgentActivity,
} from "../../Assets/Scripts/App/AppState";
import {
  createAgentSpeechSessionState,
  reduceFinalTranscript,
  touchAgentSpeechSession,
} from "../../Assets/Scripts/App/Agent/AgentSpeechSession";

describe("agent speech bridge-offline behavior", () => {
  it("keeps session active after a send action even when bridge would reject the command", () => {
    const { state, action } = reduceFinalTranscript(
      createAgentSpeechSessionState(),
      "Robot go forward",
      10,
    );

    expect(action).toEqual({ kind: "send", text: "go forward" });
    expect(state.active).toBe(true);
  });

  it("keeps session active after follow-up commands in an open session", () => {
    const open = touchAgentSpeechSession(createAgentSpeechSessionState(), 5);
    open.active = true;
    const { state, action } = reduceFinalTranscript(open, "turn left", 10);

    expect(action).toEqual({ kind: "send", text: "turn left" });
    expect(state.active).toBe(true);
  });

  it("bridge disconnect reset clears agent wire state but not operating mode", () => {
    const store = new AppStateStore();
    store.update({
      phase: "runtime",
      operatingMode: "agent",
      agentSpeechSessionActive: true,
      agentActivity: { state: "busy", detail: "working" },
    });

    store.update({
      agentActivity: createDefaultAgentActivity(),
      agentSpeechSessionActive: false,
    });

    const snapshot = store.snapshot;
    expect(snapshot.operatingMode).toBe("agent");
    expect(snapshot.phase).toBe("runtime");
    expect(snapshot.agentActivity.state).toBe("idle");
    expect(snapshot.agentSpeechSessionActive).toBe(false);
  });
});
