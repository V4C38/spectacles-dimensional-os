import type { AgentDraftSnapshot } from "../../DimOSARClient/agent/AgentDraftSession";
import type { LidarDisplayPreferences } from "../../DimOSARClient/sensors/lidarDisplayPreferences";
import type { LidarDisplayMode } from "../../DimOSARClient/sensors/lidarSettings";
import type { OperatingMode } from "./AppState";

/** Facts for native views; page selection and frame placement stay in the host. */
export interface SpecsUISnapshot {
  robotName: string;
  robotSelected: boolean;
  robotSelectable: boolean;
  robotConnectionText: string;
  activity: string;
  hudText: string;
  hasTrackingOrigin: boolean;
  cameraStatus: string;
  trackingStatus: string;
  surfaceCount: number | string;
  operatingMode: OperatingMode;
  agentAvailable: boolean;
  speech: AgentDraftSnapshot | null;
  lidarAvailable: boolean;
  lidarMode: LidarDisplayMode;
  lidarPreferences: LidarDisplayPreferences;
  lidarReceived: number;
  debugEnabled: boolean;
  debugText: string;
  estopAvailable: boolean;
  estopPressed: boolean;
  alignmentReview: boolean;
}
