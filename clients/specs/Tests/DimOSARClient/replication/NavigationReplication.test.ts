import { describe, expect, it } from "vitest";
import { CollaborationController } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationController";
import { NavigationInteraction } from "../../../Assets/Scripts/DimOSARClient/navigation/NavigationInteraction";
import { NavigationPreviewCoordinator } from "../../../Assets/Scripts/DimOSARClient/navigation/NavigationPreviewCoordinator";
import { JoystickNavigationController } from "../../../Assets/Scripts/DimOSARClient/navigation/JoystickNavigationController";
import type { ARModuleSessionState } from "../../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type { InteractionState } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes";
const origin = { position: [1, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
function fixture() {
  const sent: any[] = [], commands: any[] = [];
  const collaboration = new CollaborationController({ ready: () => true, clientId: () => "local", now: () => 0, send: s => sent.push(JSON.parse(s)) });
  const state: InteractionState = { type: "interaction_state", epoch: "robot", revision: 0, mode: "manual", authority: null, target: null, preview: null, active_goal: null };
  collaboration.apply(state);
  const view = { connection: "ready", hasTrackingOrigin: true, nav_goal: null, nav: null,
    capabilities: { navigation: { available: true, nav_goal: { available: true, preview: false } } } } as unknown as ARModuleSessionState;
  const preview = new NavigationPreviewCoordinator({ collaboration, view: () => view, sendText: text => sent.push(JSON.parse(text)) });
  const nav = new NavigationInteraction({ sendGoal: pose => {
    if (!collaboration.credentials()) throw new Error("No grant"); commands.push(pose);
  }, cancel() {} }, preview, 6, collaboration);
  nav.applyView(view, origin, null, 0);
  return { nav, collaboration, sent, commands, state, view, preview };
}
describe("navigation replication adapter", () => {
  it("leaves pending and granted arm authority intact when navigation is unavailable or reset", () => {
    const { nav, collaboration, state, sent, view } = fixture();
    expect(collaboration.begin("manipulation_planning", "arm-hand", { position: [0,0,1], orientation: [0,0,0,1] }, { group_id: "arm" })).toBe(true);
    const request = sent[0];
    view.capabilities!.navigation.nav_goal.available = false;
    nav.applyView(view, origin, null, 0); nav.reset();
    expect(collaboration.snapshot("manipulation", "arm").pending).toBe(true);
    expect(sent).toHaveLength(1);
    collaboration.apply({ ...state, revision: 1, authority: { client_id: "local", source_id: "arm-hand", acquisition_id: request.acquisition_id,
      lease_id: "arm-lease", kind: "manipulation_planning", group_id: "arm", held: true, sequence: -1, expires_at: 1 } });
    collaboration.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1, status: "accepted", code: "acquired", lease_id: "arm-lease" });
    nav.applyView(view, origin, null, 0.1); nav.reset();
    expect(collaboration.snapshot("manipulation", "arm").ownsAuthority).toBe(true);
    expect(sent).toHaveLength(1);
  });
  it("still retires its own selected navigation reservation on reset", () => {
    const { nav, collaboration, state, sent } = fixture(); nav.setSelected(true);
    nav.hold(0, { position: [2,0,0], blocked: false }, false, "hand");
    const request = sent[0];
    collaboration.apply({ ...state, revision: 1, authority: { client_id: "local", source_id: "hand", acquisition_id: request.acquisition_id,
      lease_id: "nav-lease", kind: "navigation_planning", held: true, sequence: -1, expires_at: 1 } });
    collaboration.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1, status: "accepted", code: "acquired", lease_id: "nav-lease" });
    nav.reset();
    expect(sent.at(-1)).toMatchObject({ action: "cancel", lease_id: "nav-lease" });
  });
  it("requests acknowledged canonical samples and retries invalidation without waiting for exact hand prediction", () => {
    const { nav, collaboration, state, sent, view } = fixture();
    view.capabilities!.navigation.nav_goal.preview = true; nav.applyView(view, origin, null, 0); nav.setSelected(true);
    nav.hold(0, { position: [2,0,0], blocked: false }, false, "hand");
    const request = sent[0];
    const authority = { client_id: "local", source_id: "hand", acquisition_id: request.acquisition_id, lease_id: "lease", kind: "navigation_planning" as const, held: true, expires_at: 1, sequence: -1 };
    const target = { position: [3,0,0] as [number,number,number], orientation: [0,0,0,1] as [number,number,number,number], phase: "draft" as const, revision: 1, sequence: -1, sample_ts: 100 };
    collaboration.apply({ ...state, revision: 1, authority, target });
    collaboration.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1, status: "accepted", code: "acquired", lease_id: "lease" });
    nav.aim(0.1, { position: [3,0,0], blocked: false }, "hand"); nav.tick(0.1);
    expect(nav.snapshot().draft!.position[0]).toBe(3);
    expect(sent.filter(packet => packet.type === "nav_goal_request")).toHaveLength(1);
    expect(sent.find(packet => packet.type === "nav_goal_request")).toMatchObject({ position: [3,0,0] });
    const update = sent.find(packet => packet.action === "update");
    collaboration.apply({ ...state, revision: 2, authority: { ...authority, sequence: update.sequence }, target: { ...target, position: [4,0,0], revision: 2, sequence: update.sequence } });
    nav.tick(0.2);
    expect(sent.filter(packet => packet.type === "nav_goal_request")).toHaveLength(1);
    nav.tick(0.5);
    expect(sent.filter(packet => packet.type === "nav_goal_request")).toHaveLength(2);
    const second = sent.filter(packet => packet.type === "nav_goal_request").at(-1);
    expect(second).toMatchObject({ preview: true, position: [4,0,0], lease_id: "lease" });
    view.nav_preview = { type: "nav_goal", preview: true, preview_id: second.preview_id, pose: [4,0,0,0], path_poses: [[0,0,0,0],[4,0,0,0]], ts: 1 };
    nav.applyView(view, origin, null, 0.55);
    collaboration.apply({ ...state, revision: 3, authority, target: { ...target, position: [4.01,0,0], revision: 3, sequence: update.sequence } });
    nav.tick(0.9);
    expect(sent.filter(packet => packet.type === "nav_goal_request")).toHaveLength(3);
    expect(sent.filter(packet => packet.type === "nav_goal_request").at(-1)).toMatchObject({ position: [4.01,0,0] });
  });
  it("clears an invalidated shared preview without reviving a private stale route", () => {
    const { nav, preview, collaboration, state } = fixture();
    preview.previewPath = () => [[0,0,0,0], [8,0,0,0]];
    collaboration.apply({ ...state, revision: 1, preview: { type: "nav_goal", preview: true, pose: [2,0,0,0], path_poses: [[0,0,0,0], [2,0,0,0]], ts: 1 } });
    expect(nav.previewPath()?.at(-1)?.[0]).toBe(2);
    collaboration.apply({ ...state, revision: 2, preview: null });
    expect(nav.previewPath()).toBeNull();
  });
  it("cancels a pending joystick acquisition when the stick returns to neutral", () => {
    const { collaboration, sent } = fixture();
    const joystick = new JoystickNavigationController({
      collaboration,
      view: () => ({ connection: "ready", capabilities: { navigation: { nav_joystick: { available: true } } } }) as ARModuleSessionState,
      sendText: text => sent.push(JSON.parse(text)),
    });
    joystick.tick(0, { x: 1, y: 0 });
    expect(sent[0].action).toBe("acquire");
    expect(sent.some(packet => packet.type === "nav_joystick_request")).toBe(false);
    joystick.tick(0.01, null);
    expect(sent[sent.length - 1].action).toBe("cancel_acquire");
    expect(collaboration.snapshot().pending).toBe(false);
  });
  it("moves the local target before grant while keeping native motion gated", () => {
    const { nav, commands } = fixture();
    nav.hold(0, { position: [2, 0, 0], blocked: false }, true, "hand");
    nav.hold(0.1, { position: [3, 0, 0], blocked: false }, true, "hand");
    expect(nav.snapshot().position[0]).toBe(3); expect(commands).toEqual([]);
  });
  it("renders another client's selected draft and preview without local selection", () => {
    const { nav, collaboration, state } = fixture();
    collaboration.apply({ ...state, revision: 1,
      authority: { client_id: "remote", source_id: "hand", acquisition_id: "a", lease_id: "l", kind: "navigation_planning", held: false, sequence: 1, expires_at: 1 },
      target: { position: [4, 0, 0], orientation: [0, 0, 0, 1], phase: "draft", revision: 1, sequence: 1, sample_ts: 100 },
      preview: { type: "nav_goal", preview: true, pose: [4,0,0,0], path_poses: [[2,0,0,0],[4,0,0,0]], ts: 1 } });
    expect(nav.snapshot().selected).toBe(false); expect(nav.snapshot().blocked).toBe(true);
    expect(nav.snapshot().draft?.position[0]).toBe(3); expect(nav.isAiming()).toBe(true);
    expect(nav.previewPath()).toHaveLength(2);
    expect(nav.hold(0, { position: [6,0,0], blocked: false }, true, "hand")).toBe(false);
  });
  it("retains exclusive selected planning across first release and confirms through one transaction", () => {
    const { nav, collaboration, state, sent, commands } = fixture(); nav.setSelected(true);
    const placement = { position: [2,0,0] as [number,number,number], blocked: false };
    nav.hold(0, placement, false, "hand");
    const acquire = sent[0];
    collaboration.apply({ ...state, revision: 1, authority: { client_id: "local", source_id: "hand", acquisition_id: acquire.acquisition_id, lease_id: "l", kind: "navigation_planning", held: true, expires_at: 1, sequence: -1 } });
    collaboration.accept({ type: "interaction_result", request_id: acquire.request_id, epoch: "robot", revision: 1, status: "accepted", code: "acquired", lease_id: "l" });
    nav.release(0.1, placement, "hand");
    expect(collaboration.snapshot().ownsAuthority).toBe(true);
    expect(sent[sent.length - 1].action).toBe("release"); expect(commands).toEqual([]);
    nav.hold(0.2, placement, false, "hand"); nav.release(0.3, placement, "hand");
    expect(sent[sent.length - 1]).toMatchObject({ action: "confirm", position: [3,0,0] });
    expect(commands).toEqual([]);
  });
  it("does not render an arm target as a navigation marker", () => {
    const { nav, collaboration, state } = fixture();
    collaboration.apply({ ...state, revision: 1, target: { domain: "manipulation", group_id: "arm", position: [8,0,1], orientation: [0,0,0,1], phase: "draft", revision: 1, sequence: 1, sample_ts: 1 } });
    expect(nav.snapshot().draft).toBeNull(); expect(nav.snapshot().position[0]).toBe(0);
  });
});

it.each([null, { position: [3, 0, 0] as [number, number, number], blocked: true }])(
  "retires a direct drag released over invalid placement %j",
  placement => {
    const { nav, collaboration, state, sent } = fixture();
    nav.hold(0, { position: [2, 0, 0], blocked: false }, true, "hand");
    const request = sent[0];
    collaboration.apply({ ...state, revision: 1, authority: {
      client_id: "local", source_id: "hand", acquisition_id: request.acquisition_id,
      lease_id: "nav-lease", kind: "live", held: true, sequence: -1, expires_at: 1,
    } });
    collaboration.accept({ type: "interaction_result", request_id: request.request_id,
      epoch: "robot", revision: 1, status: "accepted", code: "acquired", lease_id: "nav-lease" });
    nav.hold(0.1, { position: [3, 0, 0], blocked: false }, true, "hand");
    expect(nav.isDragging()).toBe(true);
    nav.release(0.2, placement, "hand");
    expect(sent.at(-1)).toMatchObject({ action: "cancel", lease_id: "nav-lease" });
    expect(nav.isDragging()).toBe(false);
    const count = sent.length;
    collaboration.tick();
    expect(sent).toHaveLength(count);
    collaboration.apply({ ...state, revision: 2 });
    expect(collaboration.begin("manipulation_planning", "arm", undefined, { group_id: "arm" })).toBe(true);
  },
);
