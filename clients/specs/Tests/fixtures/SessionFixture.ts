import { PairedBulk } from "./PairedBulk";
import type { ClientClock, WebSocketTransport } from "../../Assets/Scripts/DimOSARClient/websocket/hostPorts";
import type { Capabilities, Hello, State } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

export class FakeClock implements ClientClock {
  nowS = 0;
  now(): number {
    return this.nowS;
  }
}

export class FakeTransport implements WebSocketTransport {
  readonly bulk = new PairedBulk(data => this.binaries.push(data));
  createSibling() { return this.bulk; }
  connectCount = 0;
  closeCount = 0;
  texts: string[] = [];
  binaries: Uint8Array[] = [];

  connect(): void {
    this.connectCount += 1;
  }

  close(): void {
    this.closeCount += 1;
  }

  sendText(text: string): void {
    this.texts.push(text);
  }

  sendBinary(data: Uint8Array): void {
    this.binaries.push(data);
  }
}

export function helloAt(tsClient: number, capabilities?: Partial<Capabilities>): Hello {
  return {
    resume_token: "fixture-resume",
    odom_reference_id: "fixture-odom",
    localization: { providers: ["fiducial_marker"] },
    type: "hello", protocol_version: 2, bulk_url: "/bulk", bulk_token: "fixture-token", bulk_epoch: "fixture-epoch",
    client_id: "c3f1a9",
    time_sync: { ts_client: tsClient, ts_server: 100 },
    robot: {
      odom_scale_correction_factor: 1,
      display_name: "Unitree Go2",
      body_bounds_m: [0.7, 0.5, 0.55],
      footprint_m: [0.7, 0.5],
      base_height_m: 0.33,
    },
    capabilities: {
      manipulation: { available: false, reason: "No arm" },
      object_detection: { available: false, reason: "No detector" },
      lidar: { available: true, reason: null },
      navigation: {
        available: true,
        reason: null,
        nav_goal: { preview: false, available: true, reason: null },
        nav_joystick: { available: true, reason: null },
      },
      localization: { available: true, reason: null },
      estop: { available: true, reason: null },
      agent: { available: false, reason: "current blueprint has no DimOS agent" },
      ...capabilities,
    },
  };
}

export function stateFrame(): State { return {
  type: "state",
  server: { connected_clients: 1 },
  lidar: { enabled: true, min_height_m: 0.1, max_height_m: 1.5, max_range_m: 5 },
  nav: { state: "idle", outcome: null },
  agent: { idle: true },
}; }


/** Fixture server publication: navigation domain facts ride one revisioned snapshot. */
export function navigationSnapshot(current: import("../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes").InteractionState | null,
  goal: import("../../Assets/Scripts/DimOSARClient/websocket/protocolTypes").NavGoal) {
  const state = current ?? { type: "interaction_state" as const, epoch: "fixture-navigation", revision: 0,
    mode: "manual" as const, authority: null, targets: [], motion_busy: false, following_tail: null,
    preview: null, active_goal: null };
  return { ...state, revision: state.revision + 1, [goal.preview ? "preview" : "active_goal"]: goal };
}
