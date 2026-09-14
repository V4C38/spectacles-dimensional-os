import { encodeNavGoalRequest } from "../websocket/protocol";
import { requireNavigation, type ARModuleSession } from "../websocket/arModuleSession";
import type { Quat, Vec3 } from "../websocket/protocolTypes";

export function requestNavGoal(
  session: ARModuleSession,
  goal: { position: Vec3; orientation: Quat },
): void {
  requireNavigation(session, "nav_goal");
  session.sendText(encodeNavGoalRequest(goal));
}
