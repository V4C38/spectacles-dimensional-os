import type { AgentDraftSnapshot } from "DimOSARClient.lspkg/Scripts/DimOSARClient/agent/AgentDraftSession";
import type { LidarDisplayPreferences } from "DimOSARClient.lspkg/Scripts/DimOSARClient/sensors/lidarDisplayPreferences";
import type { LidarDisplayMode } from "DimOSARClient.lspkg/Scripts/DimOSARClient/sensors/lidarSettings";
import type { OperatingMode } from "./AppState";

/** Facts for native views; page selection and frame placement stay in the host. */
export interface SpecsUISnapshot {
  localizationAvailable?: boolean;
  manipulationAvailable?: boolean;
  manipulationSpeed?: number;
  manipulationEnabled?: boolean;
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
