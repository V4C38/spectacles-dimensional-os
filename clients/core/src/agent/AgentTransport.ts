import { clientTrackingToOdomPose, type ClientTrackingOriginStore } from "../localization/ClientTracking";

import { requireCapability, type ARModuleSession } from "../websocket/ARModuleSession";
import type { CameraTrackingSource, ClientClock } from "../ClientContracts";
import { encodeClientPose, encodeUserMessageRequest } from "../websocket/protocol";
/** Shared agent pose publication policy; optical tracking is supplied by the host. */
export class ClientPosePublisher {
  private lastSentAt = -Infinity;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText">, private readonly origins: ClientTrackingOriginStore, private readonly tracking: CameraTrackingSource, private readonly clock: ClientClock) {}
  tick(): void {
    const now = this.clock.now(), origin = this.origins.T_odom_client, view = this.session.view();
    if (now - this.lastSentAt < 0.1 || !origin || view.connection !== "ready" || view.capabilities?.agent.available !== true) return;
    let optical: ReturnType<CameraTrackingSource["cameraOptical"]>;
    try { optical = this.tracking.cameraOptical(); } catch { return; }
    const pose = clientTrackingToOdomPose(optical, origin);
    this.session.sendText(encodeClientPose({ ...pose, ts: now })); this.lastSentAt = now;
  }
}

export function requestUserMessage(session: Pick<ARModuleSession, "view" | "sendText">, text: string): void {
  requireCapability(session, "agent");
  session.sendText(encodeUserMessageRequest(text));
}
