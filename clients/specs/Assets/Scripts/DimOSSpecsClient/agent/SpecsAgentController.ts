import { AgentDraftSession, type AgentDraftSnapshot, type SynthesisPort } from "DimOSARClient.lspkg/Scripts/DimOSARClient/agent/AgentDraftSession";
import { requestUserMessage } from "DimOSARClient.lspkg/Scripts/DimOSARClient/agent/AgentTransport";
import type { ARModuleSession } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ARModuleSession";
import type { OperatingMode } from "../presentation/UIPresentationState";
import { SpecsRecognition } from "./SpecsSpeechAdapters";

export interface AgentSpeechControllerDeps {
  asrModule: AsrModule | null;
  session: Pick<ARModuleSession, "view" | "sendText">;
  tts: SynthesisPort & { tick(): void };
  getOperatingMode: () => OperatingMode;
  isSelected: () => boolean;
  select: () => void;
  isSetupCompleted: () => boolean;
  emergencyStop: () => void;
}

/** Native speech is an adapter; draft, recording and submission belong to ClientCore. */
export class SpecsAgentController {
  readonly draft: AgentDraftSession;
  private readonly recognition: SpecsRecognition | null;
  private bound = false;

  constructor(private readonly deps: AgentSpeechControllerDeps) {
    this.recognition = deps.asrModule ? new SpecsRecognition(deps.asrModule) : null;
    this.draft = new AgentDraftSession({
      recognition: this.recognition,
      synthesis: deps.tts,
      send: text => requestUserMessage(deps.session, text),
      estop: deps.emergencyStop,
      isSelected: deps.isSelected,
      select: deps.select,
    });
  }

  get asrRunning(): boolean { return this.draft.isRecording(); }
  snapshot(): AgentDraftSnapshot { return this.draft.snapshot(); }
  bind(): void { this.bound = true; this.syncEnabled(); }
  beginRecording(): boolean { this.syncEnabled(); return this.draft.beginRecording(); }
  endRecording(cancel = false): void { this.draft.endRecording(cancel); }
  setDraft(text: string): void { this.draft.setDraft(text); }
  submit(): boolean { return this.draft.submitTyped(this.draft.snapshot().prompt); }
  reset(): void { this.draft.reset(); }
  dispose(): void { this.bound = false; this.draft.stop(); }
  tick(): void { this.recognition?.tick(); this.deps.tts.tick(); this.syncEnabled(); }

  syncEnabled(): void {
    if (!this.bound) return;
    const view = this.deps.session.view();
    const enabled = this.deps.isSetupCompleted() && this.deps.getOperatingMode() === "agent" &&
      view.connection === "ready" && view.capabilities?.agent.available === true;
    this.draft.tick(getTime(), enabled, view.agentMessage, view.state?.agent.idle ?? true, view.agentMessageRevision);
  }
}
