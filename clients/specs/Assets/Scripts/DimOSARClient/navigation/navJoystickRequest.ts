import { encodeNavJoystickRequest } from "../websocket/protocol";
import { requireNavigation, type ARModuleSession } from "../websocket/arModuleSession";
import type { Vec3 } from "../websocket/protocolTypes";

export function requestNavJoystick(
  session: ARModuleSession,
  command: { linear: Vec3; angular: Vec3; duration?: number },
): void {
  requireNavigation(session, "nav_joystick");
  session.sendText(encodeNavJoystickRequest(command));
}
