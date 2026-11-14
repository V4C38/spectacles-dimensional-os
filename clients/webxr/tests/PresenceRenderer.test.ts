import { expect, it } from "vitest";
import * as THREE from "three";
import { PresenceRenderer } from "../src/presentation/PresenceRenderer";

it("renders two passive pointers and a background, reuses meshes, and disposes removed users", () => {
  const renderer = new PresenceRenderer();
  const cues = { pointers: [0,1].map(id => ({ id, start: [0,0,0] as [number,number,number], control: [.5,0,0] as [number,number,number], end: [1,0,0] as [number,number,number], opacity: .4, cursor: id === 0 })),
    panel: { position: [1,2,3] as [number,number,number], orientation: [0,0,0,1] as [number,number,number,number], width: .5, height: .3 } };
  renderer.update([{ client_id: "specs-peer", cues }]);
  const user = renderer.object.children[0], panel = user.children[0] as THREE.Mesh;
  expect(user.children).toHaveLength(5); expect(panel.scale.x).toBe(.5);
  expect(panel.position.toArray()).toEqual([-2,3,-1]);
  renderer.object.traverse(o => { expect(o.userData.rayTarget).toBeUndefined(); expect(o.userData.touchButton).toBeUndefined(); });
  const geometry = (user.children[1] as THREE.Line).geometry;
  renderer.update([{ client_id: "specs-peer", cues: { ...cues, panel: null } }]);
  expect(renderer.object.children[0]).toBe(user); expect((user.children[1] as THREE.Line).geometry).toBe(geometry);
  expect(panel.visible).toBe(false);
  renderer.update([]); expect(renderer.object.children).toHaveLength(0); renderer.dispose();
});
