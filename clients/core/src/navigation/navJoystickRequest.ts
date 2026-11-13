import type { InteractionAuthorityPort } from "../replication/CollaborationTypes";
import { encodeNavJoystickRequest } from "../websocket/protocol";
import { requireNavigation, type ARModuleSession } from "../websocket/arModuleSession";
import type { Vec3 } from "../websocket/protocolTypes";

export function requestNavJoystick(
  session: Pick<ARModuleSession, "view" | "sendText"> & { collaboration: InteractionAuthorityPort },
  command: { linear: Vec3; angular: Vec3; duration?: number },
): void {
  requireNavigation(session, "nav_joystick");
  const credentials = session.collaboration.credentials();
  if (!credentials) throw new Error("Joystick requires grab authority");
  session.sendText(encodeNavJoystickRequest({ ...command, ...credentials }));
}
