import { ARM_VISUAL_STYLE, armShapeEdges } from "@dimos-ar-client/manipulation/ManipulationVisuals";
import type {
  ManipulationModel,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import {
  clientTrackingToWebxrPoint,
} from "../utilities/WebXRCoordinates";
import { armMaterial } from "./ArmMaterial";
import { disposeObjectTrees } from "./ObjectResources";
import { visualProfile } from "./profiles/ManipulationVisualProfile";

const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...clientTrackingToWebxrPoint([1, 0, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 1, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 0, 1])),
);

export class ManipulationModelRenderer {
  readonly object = new THREE.Group();
  readonly previewMeshes = new Map<string, THREE.Object3D>();
  readonly ghosts = new Map<string, THREE.Object3D>();
  model: ManipulationModel | null = null;
  assetMessage = "";
  private assetGeneration = 0;
  private disposed = false;
  rebuild(model: ManipulationModel): void {
    this.clear();
    this.model = model;
    const generation = ++this.assetGeneration;
    if (model.asset_url)
      new GLTFLoader().load(
        model.asset_url,
        (gltf) => {
          if (this.disposed || generation !== this.assetGeneration) {
            disposeObjectTrees([gltf.scene]);
            return;
          }
          if (
            model.visual_signature &&
            gltf.scene.userData.visual_signature !== model.visual_signature
          ) {
            disposeObjectTrees([gltf.scene]);
            this.assetMessage =
              "\nPreview mesh does not match configured robot model";
            return;
          }
          const sourceMaterials = new Set<THREE.Material>();
          for (const link of model.links) {
            const node = gltf.scene.getObjectByName(link.name);
            if (!node) continue;
            node.removeFromParent();
            node.position.set(0, 0, 0);
            node.quaternion.identity();
            node.scale.setScalar(1);
            node.traverse((part) => {
              part.raycast = () => {};
              if (part instanceof THREE.Mesh) {
                if (!part.geometry.getAttribute("normal"))
                  part.geometry.computeVertexNormals();
                part.geometry.applyMatrix4(BASIS);
                if (link.name === model.root)
                  part.geometry.rotateY(visualProfile(model).rootMeshRotationY);
                const old = Array.isArray(part.material)
                  ? part.material
                  : [part.material];
                old.forEach((m) => sourceMaterials.add(m));
                part.material = armMaterial();
              }
            });
            const surfaces: THREE.Mesh[] = [];
            node.traverse(part => { if (part instanceof THREE.Mesh) surfaces.push(part); });
            for (const part of surfaces) {
              const position = part.geometry.getAttribute("position");
              const points = armShapeEdges(Array.from(position.array), part.geometry.index
                ? Array.from(part.geometry.index.array) : Array.from({ length: position.count }, (_, i) => i));
              const stroke = new AdaptiveDashedLineRenderer(ARM_VISUAL_STYLE.widthM, ARM_VISUAL_STYLE.dashM,
                ARM_VISUAL_STYLE.gapM, ARM_VISUAL_STYLE.minimumPixels);
              stroke.setSegments(points);
              stroke.setStyle(ARM_VISUAL_STYLE.widthM, ARM_VISUAL_STYLE.opacity);
              stroke.object.userData.armOutline = true;
              stroke.object.raycast = () => {};
              part.add(stroke.object);
            }
            const previewNode = node.clone(true);
            previewNode.traverse((part) => {
              if (part instanceof THREE.Mesh) part.material = part.userData.armOutline
                ? (part.material as THREE.Material).clone() : armMaterial();
            });
            previewNode.traverse(part => {
              if (!(part instanceof THREE.Mesh) || !part.userData.armOutline) return;
              const viewport = new THREE.Vector4();
              part.onBeforeRender = renderer => {
                renderer.getCurrentViewport(viewport);
                (part.material as THREE.ShaderMaterial).uniforms.uViewport.value.set(Math.max(1, viewport.z), Math.max(1, viewport.w));
              };
            });
            previewNode.traverse(part => { part.raycast = () => {}; });
            // Picking stays alive when presentation is hidden. Use the actual triangles,
            // never the link's broad-phase bounding box, as the selection surface.
            node.traverse(part => {
              if (!(part instanceof THREE.Mesh)) return;
              if (part.userData.armOutline) { part.visible = false; return; }
              (part.material as THREE.Material).dispose();
              part.material = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
              part.raycast = THREE.Mesh.prototype.raycast;
              part.userData.manipulationLink = link.name;
              part.userData.meshSelection = true;
              part.userData.rayPriority = 20;
              registerRayTarget(part);
            });
            previewNode.visible = false;
            this.previewMeshes.set(link.name, previewNode);
            this.object.add(previewNode);
            this.ghosts.set(link.name, node);

            this.object.add(node);
          }
          disposeObjectTrees([gltf.scene], sourceMaterials);
          this.assetMessage = "";
        },
        undefined,
        () => {
          if (generation === this.assetGeneration)
            this.assetMessage = "\nPreview mesh unavailable";
        },
      );
  }
  clear(): void {
    this.assetGeneration++;
    disposeObjectTrees([
      ...this.previewMeshes.values(),
      ...this.ghosts.values(),
    ]);
    this.previewMeshes.clear();
    this.ghosts.clear();
    this.model = null;
    this.assetMessage = "";
  }
  dispose(): void {
    this.disposed = true;
    this.clear();
    this.object.removeFromParent();
  }
}
