import type { PresenceController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/replication/PresenceController";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsPose } from "../utilities/SpecsCoordinates";
import { CursorLaserRenderer } from "./CursorLaserPresenter";
import { WorldMeshRenderer } from "./WorldMeshRenderer";
import { createRoundedSurface } from "./UIKit";

const DOT = [0,.4,0, .4,0,0, 0,0,.4, -.4,0,0, 0,0,-.4, 0,-.4,0];
const DOT_INDICES = [0,1,2,0,2,3,0,3,4,0,4,1,5,2,1,5,3,2,5,4,3,5,1,4];
type UserVisual = { root: SceneObject; panel: { object: SceneObject; visual: RenderMeshVisual; surface: ReturnType<typeof createRoundedSurface> }; pointers: { beam: CursorLaserRenderer; dot: WorldMeshRenderer }[] };

/** Native passive meshes only; remote menus never construct SIK/SUK controls. */
export class SpecsPresenceRenderer {
  private readonly users = new Map<string, UserVisual>();
  constructor(private readonly parent: SceneObject) {}
  update(snapshot: ReturnType<PresenceController["snapshot"]>): void {
    const seen = new Set<string>();
    for (const { client_id, cues } of snapshot) {
      seen.add(client_id);
      let user = this.users.get(client_id);
      if (!user) {
        const root = global.scene.createSceneObject(`Remote cues ${client_id}`); root.setParent(this.parent);
        const surface = createRoundedSurface(root, "Remote menu background", 1, 1, vec3.zero(), new vec4(.12,.16,.21,.6), .1, 10);
        surface.renderMeshVisual.mainPass.twoSided = true;
        const panel = { object: surface.getSceneObject(), visual: surface.renderMeshVisual, surface };
        const pointers = [0,1].map(id => {
          const beam = new CursorLaserRenderer(root, `Remote laser ${id}`);
          for (const { pass } of beam.layers) pass.depthTest = true;
          const dot = new WorldMeshRenderer(root, `Remote cursor ${id}`);
          dot.triangles(DOT, DOT_INDICES, [.84,.91,1,.7]);
          return { beam, dot };
        });
        user = { root, panel, pointers }; this.users.set(client_id, user);
      }
      for (let id = 0; id < 2; id++) {
        const p = cues.pointers.find(p => p.id === id), visual = user.pointers[id];
        if (!p) { visual.beam.hide(); visual.dot.hide(); continue; }
        visual.beam.apply({ start: clientTrackingToSpecsPoint(p.start), control: clientTrackingToSpecsPoint(p.control),
          end: clientTrackingToSpecsPoint(p.end), opacity: p.opacity * .8 });
        visual.dot.object.enabled = p.cursor;
        visual.dot.object.getTransform().setWorldPosition(new vec3(...clientTrackingToSpecsPoint(p.end)));
      }
      user.panel.object.enabled = !!cues.panel;
      if (cues.panel) {
        const pose = clientTrackingToSpecsPose(cues.panel), transform = user.panel.object.getTransform();
        transform.setWorldPosition(new vec3(...pose.position));
        transform.setWorldRotation(new quat(pose.orientation[3], pose.orientation[0], pose.orientation[1], pose.orientation[2]));
        const width = cues.panel.width * 100, height = cues.panel.height * 100;
        if (user.panel.surface.size.x !== width || user.panel.surface.size.y !== height) {
          user.panel.surface.size = new vec2(width, height);
          user.panel.surface.cornerRadius = Math.min(2.5, width / 8, height / 8);
        }
      }
    }
    for (const [id, user] of this.users) if (!seen.has(id)) { user.root.destroy(); this.users.delete(id); }
  }
  dispose(): void { this.update([]); }
}
