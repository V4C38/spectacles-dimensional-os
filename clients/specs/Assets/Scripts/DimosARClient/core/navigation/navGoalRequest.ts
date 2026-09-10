import { encodeNavGoalRequest } from "../websocket/protocol";
import { requireCapability, type ARModuleSession } from "../websocket/arModuleSession";
import type { Quat, Vec3 } from "../websocket/protocolTypes";

export function requestNavGoal(
  session: ARModuleSession,
  goal: { position: Vec3; orientation: Quat },
): void {
  requireCapability(session, "navigation");
  session.sendText(encodeNavGoalRequest(goal));
}
