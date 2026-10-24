import { encodeNavGoalRequest } from "../websocket/protocol";
import { requireNavigation, type ARModuleSession } from "../websocket/arModuleSession";
import type { Quat, Vec3 } from "../websocket/protocolTypes";

export function requestNavGoal(
  session: Pick<ARModuleSession, "view" | "sendText">,
  goal: { position: Vec3; orientation: Quat },
): void {
  requireNavigation(session, "nav_goal");
  session.sendText(encodeNavGoalRequest(goal));
}


export function requestNavPreview(
  session: Pick<ARModuleSession, "view" | "sendText">,
  goal: { position: Vec3; orientation: Quat; preview_id: string },
): void {
  requireNavigation(session, "nav_goal");
  if (session.view().capabilities?.navigation.nav_goal.preview !== true) throw new Error("Navigation preview is unavailable");
  session.sendText(encodeNavGoalRequest({ ...goal, preview: true }));
}
