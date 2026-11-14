import { integrationTestsEnabled } from "../Scripts/Integration Test Harness";
import { emitReviewEvent, findProductionRoot } from "./IntegrationHost";
import { PresenceController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/replication/PresenceController";
import { ClientTrackingOriginStore } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import { decodeOutbound } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/protocol";
import type { PresenceState } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { specsToClientTrackingPoint, specsToClientTrackingQuat } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import { SpecsPresenceRenderer } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsPresenceRenderer";

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private elapsed = 0;
  private phase = -1;
  private failed = false;
  private renderer: SpecsPresenceRenderer | null = null;
  private core!: PresenceController;
  private sample!: PresenceState;
  private now = 0;
  private panel: SceneObject | null = null;
  onAwake(): void {
    if (!integrationTestsEnabled(this.getSceneObject())) return;
    this.createEvent("UpdateEvent").bind(() => this.tick());
    this.createEvent("OnDestroyEvent").bind(() => this.renderer?.dispose());
  }
  private check(name: string, passed: boolean): void {
    this.failed ||= !passed; emitReviewEvent({ type: "result", name, passed });
  }
  private apply(): void { this.core.apply(decodeOutbound(JSON.stringify(this.sample)) as PresenceState); }
  private tick(): void {
    const dt = Math.min(.1, getDeltaTime()); this.now += dt; this.elapsed += dt;
    if (this.elapsed < (this.phase < 0 ? this.startDelayS : 2)) {
      this.renderer?.update(this.core.snapshot()); return;
    }
    this.elapsed = 0; this.phase++;
    if (this.phase === 0) {
      const root = findProductionRoot(); if (!root) throw new Error("Production root missing");
      root.updateEvent.enabled = false; root.uiPresenter.setupWizardController.invalidatePending();
      root.uiPresenter.setupWizardPanel.enabled = false; root.uiPresenter.mainUIFrame.enabled = false;
      const origins = new ClientTrackingOriginStore(), context = { map_code: "presence-probe", odom_reference_id: "probe" };
      origins.setMapContext(context); origins.setFromLocalizationResult({ type: "localization_result", position: [0,0,0], orientation: [0,0,0,1], ts: 0, confidence: 1 });
      this.core = new PresenceController({ ready: () => true, clientId: () => "self", now: () => this.now, send: () => {} }, origins);
      this.renderer = new SpecsPresenceRenderer(this.getSceneObject());
      const camera = root.cameraObject.getTransform(), q = camera.getWorldRotation();
      const point = (x: number, y: number, z: number) => (() => { const p = camera.getWorldPosition().add(q.multiplyVec3(new vec3(x,y,z))); return specsToClientTrackingPoint([p.x,p.y,p.z]); })();
      this.sample = { type: "presence_state", ...context, clients: [{ client_id: "webxr-peer", age_s: 0, pointers: [0,1].map(id => ({ id,
        start: point(id ? 25 : -25,-18,-40), control: point(id ? 10 : -10,-5,-75), end: point(id ? 8 : -8,0,-110), opacity: .45, cursor: true })),
        panel: { position: point(0,0,-112), orientation: specsToClientTrackingQuat([q.x,q.y,q.z,q.w]), width: .5, height: .3 } }] };
      this.apply(); this.renderer.update(this.core.snapshot());
      const user = (this.renderer as any).users.get("webxr-peer"); this.panel = user.panel.object;
      const t = this.panel!.getTransform(), pos = t.getWorldPosition(), scale = t.getWorldScale();
      const dot = user.pointers[0].dot.object.getTransform().getWorldPosition();
      emitReviewEvent({ type: "diagnostic", name: "presence-panel-pose", position: [pos.x,pos.y,pos.z], scale: [scale.x,scale.y,scale.z], dot: [dot.x,dot.y,dot.z], panel: this.sample.clients[0].panel, pass: { depthTest: user.panel.visual.mainPass.depthTest, twoSided: user.panel.visual.mainPass.twoSided, blendMode: user.panel.visual.mainPass.blendMode } });
      this.check("panel-keeps-physical-dimensions", Math.abs(user.panel.surface.size.x - 50) < .01 && Math.abs(user.panel.surface.size.y - 30) < .01 && Math.abs(pos.z - dot.z + 2) < .01);
      this.check("two-native-beams-and-cursors", user.pointers.every((p:any) => p.beam.object.enabled && p.dot.object.enabled));
      this.check("background-only-no-interaction-components", this.panel!.getComponents("Physics.ColliderComponent").length === 0);
      emitReviewEvent({ type: "scene", name: "remote-menu-and-two-pointers", videoOnly: true });
    } else if (this.phase === 1) {
      this.apply(); this.renderer!.update(this.core.snapshot());
      this.check("menu-mesh-reused", (this.renderer as any).users.get("webxr-peer").panel.object === this.panel);
      this.sample.clients[0].pointers = []; this.sample.clients[0].panel = null;
      this.apply(); this.renderer!.update(this.core.snapshot());
      const user = (this.renderer as any).users.get("webxr-peer");
      this.check("hide-clears-all-cues-immediately", !user.panel.object.enabled && user.pointers.every((p:any) => !p.beam.object.enabled && !p.dot.object.enabled));
      emitReviewEvent({ type: "scene", name: "remote-menu-hidden", videoOnly: true });
    } else {
      this.sample.clients = []; this.apply(); this.renderer!.update(this.core.snapshot());
      this.check("disconnect-disposes-native-user", (this.renderer as any).users.size === 0);
      emitReviewEvent({ type: "complete", passed: !this.failed }); this.enabled = false;
    }
  }
}
