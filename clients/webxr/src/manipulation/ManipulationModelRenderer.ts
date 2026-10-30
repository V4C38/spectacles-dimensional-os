import type {
  ManipulationGroup,
  ManipulationModel,
  ManipulationPose,
  ManipulationState,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import {
  linkPoses,
  toolSubtree,
} from "@dimos-ar-client/manipulation/ModelKinematics";
import { WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import {
  clientTrackingToWebxrPoint,
  clientTrackingToWebxrPose,
} from "../utilities/WebXRCoordinates";
import { armMaterial } from "./ArmMaterial";
import { gripperJointValues } from "./ArmToolKinematics";
import { disposeObjectTrees } from "./ObjectResources";
import { visualProfile } from "./profiles/ManipulationVisualProfile";

const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...clientTrackingToWebxrPoint([1, 0, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 1, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 0, 1])),
);

export class ManipulationModelRenderer {
  readonly object = new THREE.Group();
  readonly bounds = new Map<string, THREE.Group>();
  readonly boundStrokes = new Map<string, AdaptiveDashedLineRenderer>();
  readonly previewMeshes = new Map<string, THREE.Object3D>();
  readonly ghosts = new Map<string, THREE.Object3D>();
  endEffectorGeometry: THREE.Object3D | null = null;
  model: ManipulationModel | null = null;
  assetMessage = "";
  private assetGeneration = 0;
  private disposed = false;
  private toolGroup: string | null = null;
  updateTool(
    model: ManipulationModel,
    group: ManipulationGroup | undefined,
    filtered: Record<string, number>,
    opening: number | null,
    visible: boolean,
  ): void {
    if (this.toolGroup !== (group?.id ?? null)) {
      if (this.endEffectorGeometry) {
        this.endEffectorGeometry.removeFromParent();
        // Tool mesh materials are owned here; geometry and line materials belong to the model.
        this.endEffectorGeometry.traverse((part) => {
          if (part instanceof THREE.Mesh)
            (Array.isArray(part.material)
              ? part.material
              : [part.material]
            ).forEach((m) => m.dispose());
        });
        this.endEffectorGeometry = null;
      }
      this.toolGroup = group?.id ?? null;
    }
    if (!this.endEffectorGeometry && group?.tip_frame && this.ghosts.size) {
      const { links } = toolSubtree(model, group.tip_frame);
      const root = new THREE.Group();
      for (const name of links) {
        const visual = this.ghosts.get(name);
        if (!visual) continue;
        const clone = visual.clone(true);
        clone.visible = true;
        clone.userData.toolLink = name;
        clone.traverse((part) => {
          part.raycast = () => {};
          if (part instanceof THREE.Mesh) part.material = armMaterial(true);
        });
        root.add(clone);
      }
      this.endEffectorGeometry = root;
      this.object.add(root);
    }
    if (this.endEffectorGeometry && group?.tip_frame) {
      const values = { ...filtered };
      Object.assign(values, gripperJointValues(model, group, opening));
      const poses = linkPoses(model, values);
      const matrix = (pose: ManipulationPose) => {
        const p = clientTrackingToWebxrPose(pose);
        return new THREE.Matrix4().compose(
          new THREE.Vector3(...p.position),
          new THREE.Quaternion(...p.orientation),
          new THREE.Vector3(1, 1, 1),
        );
      };
      const inverse = matrix(poses[group.tip_frame]).invert();
      for (const child of this.endEffectorGeometry.children) {
        const pose = poses[child.userData.toolLink];
        if (pose)
          inverse
            .clone()
            .multiply(matrix(pose))
            .decompose(child.position, child.quaternion, new THREE.Vector3());
      }
    }
    if (this.endEffectorGeometry) this.endEffectorGeometry.visible = visible;
  }
  updateGripperBounds(
    model: ManipulationModel,
    poses: Record<string, ManipulationPose>,
    groupId: string | null,
    state: ManipulationState,
  ): void {
    const group = state.groups?.find((g) => g.id === groupId);
    if (!group?.tip_frame || !group.has_gripper) return;
    const { root, links } = toolSubtree(model, group.tip_frame);
    const matrix = (pose: ManipulationPose) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(...pose.position),
        new THREE.Quaternion(...pose.orientation),
        new THREE.Vector3(1, 1, 1),
      );
    if (!poses[root]) return;
    const inverse = matrix(poses[root]).invert();
    const union = new THREE.Box3();
    for (const link of model.links) {
      if (!links.has(link.name) || !link.bounds || !poses[link.name]) continue;
      const transform = inverse.clone().multiply(matrix(poses[link.name]));
      const center = new THREE.Vector3(...link.bounds.center);
      const half = new THREE.Vector3(...link.bounds.size).multiplyScalar(0.5);
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1])
            union.expandByPoint(
              new THREE.Vector3(x, y, z)
                .multiply(half)
                .add(center)
                .applyMatrix4(transform),
            );
      if (link.name !== root) {
        const box = this.bounds.get(link.name);
        if (box) box.visible = false;
      }
    }
    if (union.isEmpty()) return;
    const box = this.bounds.get(root);
    const stroke = this.boundStrokes.get(root);
    const rootLink = model.links.find((l) => l.name === root);
    if (!box || !stroke || !rootLink) return;
    const center = union.getCenter(new THREE.Vector3());
    const size = union.getSize(new THREE.Vector3());
    const key = [...center.toArray(), ...size.toArray()]
      .map((v) => v.toFixed(5))
      .join(",");
    box.visible = true;
    if (box.userData.gripperBoundsKey === key) return;
    box.userData.gripperBoundsKey = key;
    box.userData.boundsCenter = center.toArray();
    box.userData.boundsSize = size.toArray();
    const geometry = new THREE.BoxGeometry(...size.toArray());
    geometry.translate(...center.toArray());
    geometry.applyMatrix4(BASIS);
    const collider = box.children.find(
      (c) => c.userData.manipulationLink === root,
    ) as THREE.Mesh;
    collider.geometry.dispose();
    collider.geometry = geometry;
    const edges = new THREE.EdgesGeometry(geometry);
    const positions = edges.getAttribute("position");
    stroke.setSegments(
      Array.from(
        { length: positions.count },
        (_, i) =>
          [positions.getX(i), positions.getY(i), positions.getZ(i)] as Vec3,
      ),
    );
    edges.dispose();
  }
  rebuild(model: ManipulationModel): void {
    this.clear();
    this.model = model;
    for (const link of model.links) {
      if (!link.bounds) continue;
      const group = new THREE.Group();
      let geometry: THREE.BufferGeometry;
      if (visualProfile(model).linkBounds[link.name] !== undefined) {
        const parts = visualProfile(model).linkBounds[link.name].map((box) => {
          const g = new THREE.BoxGeometry(...box.size);
          g.translate(...box.center);
          return g;
        });
        geometry = mergeGeometries(parts);
        parts.forEach((part) => part.dispose());
      } else {
        geometry = new THREE.BoxGeometry(...link.bounds.size);
        geometry.translate(...link.bounds.center);
      }
      geometry.applyMatrix4(BASIS);
      // Match the existing OpenYAM base visual correction, on this box only.
      // Keep link/world transforms and all arm mesh geometry untouched.
      if (
        link.name === model.root &&
        visualProfile(model).rootBoundsRotationY !== 0
      ) {
        group.userData.rootBoundsRotationY =
          visualProfile(model).rootBoundsRotationY;
        geometry.rotateY(visualProfile(model).rootBoundsRotationY);
      }

      const edges = new THREE.EdgesGeometry(geometry),
        positions = edges.getAttribute("position");
      const stroke = new AdaptiveDashedLineRenderer(
        WORLD_DASH_STYLE.widthM * 0.65,
        WORLD_DASH_STYLE.dashM,
        WORLD_DASH_STYLE.gapM,
        1.3,
      );
      stroke.setSegments(
        Array.from(
          { length: positions.count },
          (_, i) =>
            [positions.getX(i), positions.getY(i), positions.getZ(i)] as Vec3,
        ),
      );
      edges.dispose();
      this.boundStrokes.set(link.name, stroke);
      const outline = stroke.object;
      outline.userData.environmentDepth = true;
      outline.raycast = () => {};
      const collider = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      collider.name = `LinkBounds_${link.name}`;
      collider.userData.manipulationLink = link.name;
      collider.userData.rayPriority = 20;
      registerRayTarget(collider);
      group.add(outline, collider);
      this.bounds.set(link.name, group);
      this.object.add(group);
    }
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
            const previewNode = node.clone(true);
            previewNode.traverse((part) => {
              if (part instanceof THREE.Mesh) part.material = armMaterial();
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
    for (const stroke of this.boundStrokes.values()) stroke.dispose();
    this.boundStrokes.clear();
    disposeObjectTrees([
      ...(this.endEffectorGeometry ? [this.endEffectorGeometry] : []),
      ...this.previewMeshes.values(),
      ...this.bounds.values(),
      ...this.ghosts.values(),
    ]);
    this.endEffectorGeometry = null;
    this.previewMeshes.clear();
    this.bounds.clear();
    this.ghosts.clear();
    this.model = null;
    this.toolGroup = null;
    this.assetMessage = "";
  }
  dispose(): void {
    this.disposed = true;
    this.clear();
    this.object.removeFromParent();
  }
}
