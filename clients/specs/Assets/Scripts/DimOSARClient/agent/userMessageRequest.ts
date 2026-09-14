import { encodeUserMessageRequest } from "../websocket/protocol";
import { requireCapability, type ARModuleSession } from "../websocket/arModuleSession";

export function requestUserMessage(session: ARModuleSession, text: string): void {
  requireCapability(session, "agent");
  session.sendText(encodeUserMessageRequest(text));
}
