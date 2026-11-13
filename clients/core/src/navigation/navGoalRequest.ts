import type { InteractionAuthorityPort } from "../replication/CollaborationTypes";
import { encodeNavGoalRequest } from "../websocket/protocol";
import { requireNavigation, type ARModuleSession } from "../websocket/arModuleSession";
import type { Quat, Vec3 } from "../websocket/protocolTypes";

export function requestNavGoal(
  session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort },
  goal: { position: Vec3; orientation: Quat },
): void {
  requireNavigation(session, "nav_goal");
  const credentials = session.collaboration.credentials();
  if (!credentials) throw new Error("Navigation requires grab authority");
  session.sendText(encodeNavGoalRequest({ ...goal, ...credentials }));
}


export function requestNavPreview(
  session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort },
  goal: { position: Vec3; orientation: Quat; preview_id: string },
): void {
  requireNavigation(session, "nav_goal");
  if (session.view().capabilities?.navigation.nav_goal.preview !== true) throw new Error("Navigation preview is unavailable");
  const credentials = session.collaboration.credentials();
  if (!credentials) throw new Error("Preview requires planning authority");
  session.sendText(encodeNavGoalRequest({ ...goal, ...credentials, preview: true }));
}
