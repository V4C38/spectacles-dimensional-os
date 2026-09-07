import { encodeLidarSettingsRequest } from "../websocket/protocol";
import { requireCapability, type ARModuleSession } from "../websocket/arModuleSession";
import type { LidarSettings } from "../websocket/protocolTypes";

export function requestLidarSettings(session: ARModuleSession, settings: LidarSettings): void {
  requireCapability(session, "lidar");
  session.sendText(encodeLidarSettingsRequest(settings));
}
