import { encodeHumanInput } from "../websocket/protocol";
import { requireCapability, type ARModuleSession } from "../websocket/arModuleSession";

export function sendHumanInput(session: ARModuleSession, text: string): void {
  requireCapability(session, "agent");
  session.sendText(encodeHumanInput(text));
}
