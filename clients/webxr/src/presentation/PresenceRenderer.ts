import * as THREE from "three";
import type { PresenceController } from "@dimos-ar-client/replication/PresenceController";
import { clientTrackingToWebxrPoint, clientTrackingToWebxrPose } from "../utilities/WebXRCoordinates";
import { glassMaterial } from "./SurfaceMaterials";

type UserVisual = { root: THREE.Group; panel: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; pointers: { line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; dot: THREE.Mesh }[] };

/** Optical cues only: no interaction registration, colliders, or replicated UI trees. */
export class PresenceRenderer {
  readonly object = new THREE.Group();
  private readonly dotGeometry = new THREE.SphereGeometry(.004, 8, 6);
  private readonly dotMaterial = new THREE.MeshBasicMaterial({ color: 0xd8e9ff, transparent: true, opacity: .7, depthWrite: false });
  private readonly panelGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly users = new Map<string, UserVisual>();
  constructor() { this.object.name = "Remote interaction cues"; }
  update(snapshot: ReturnType<PresenceController["snapshot"]>): void {
    const seen = new Set<string>();
    for (const { client_id, cues } of snapshot) {
      seen.add(client_id);
      let user = this.users.get(client_id);
      if (!user) {
        const root = new THREE.Group();
        const panel = new THREE.Mesh(this.panelGeometry, glassMaterial({ width: 1, height: 1, alpha: .2, rim: .12 }));
        panel.material.side = THREE.DoubleSide;
        root.add(panel);
        const pointers = [0, 1].map(() => {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(17 * 3), 3));
          const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xd8e9ff, transparent: true, depthWrite: false }));
          const dot = new THREE.Mesh(this.dotGeometry, this.dotMaterial);
          root.add(line, dot); return { line, dot };
        });
        user = { root, panel, pointers }; this.users.set(client_id, user); this.object.add(root);
      }
      for (let id = 0; id < 2; id++) {
        const p = cues.pointers.find(p => p.id === id), visual = user.pointers[id];
        visual.line.visible = !!p; visual.dot.visible = !!p?.cursor;
        if (!p) continue;
        const a = clientTrackingToWebxrPoint(p.start), b = clientTrackingToWebxrPoint(p.control), c = clientTrackingToWebxrPoint(p.end);
        const positions = visual.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i <= 16; i++) { const t = i / 16, u = 1 - t;
          positions.setXYZ(i, u*u*a[0]+2*u*t*b[0]+t*t*c[0], u*u*a[1]+2*u*t*b[1]+t*t*c[1], u*u*a[2]+2*u*t*b[2]+t*t*c[2]); }
        positions.needsUpdate = true; visual.line.geometry.computeBoundingSphere();
        visual.line.material.opacity = p.opacity * .8;
        visual.dot.position.set(...c);
      }
      user.panel.visible = !!cues.panel;
      if (cues.panel) {
        const p = cues.panel, pose = clientTrackingToWebxrPose(p);
        user.panel.position.set(...pose.position); user.panel.quaternion.fromArray(pose.orientation); user.panel.scale.set(p.width, p.height, 1);
        user.panel.material.uniforms.uSize.value.set(p.width, p.height);
        user.panel.material.uniforms.uRadius.value = Math.min(.025, p.width / 8, p.height / 8);
      }
    }
    for (const [id, user] of this.users) if (!seen.has(id)) { this.destroyUser(user); this.users.delete(id); }
  }
  private destroyUser(user: UserVisual): void {
    user.root.removeFromParent(); user.panel.material.dispose();
    for (const { line } of user.pointers) { line.geometry.dispose(); line.material.dispose(); }
  }
  dispose(): void { this.update([]); this.dotGeometry.dispose(); this.dotMaterial.dispose(); this.panelGeometry.dispose(); this.object.removeFromParent(); }
}
