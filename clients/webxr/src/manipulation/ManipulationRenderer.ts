import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Text } from "troika-three-text";
import { WORLD_DASH_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import {
  composePose,
  linkPoses,
  samplePlan,
} from "@dimos-ar-client/manipulation/ModelKinematics";
import type {
  ManipulationModel,
  ManipulationPlan,
  ManipulationPose,
  ManipulationState,
} from "@dimos-ar-client/manipulation/ManipulationTypes";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { odomToClientTrackingPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import {
  clientTrackingToWebxrPoint,
  clientTrackingToWebxrPose,
} from "../utilities/WebXRCoordinates";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { syncText, UI_FONT_REGULAR } from "../presentation/UIFonts";
import { AdaptiveDashedLineRenderer } from "../presentation/AdaptiveDashedLineRenderer";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { EndEffectorHandleRenderer } from "./EndEffectorHandleRenderer";

const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(...clientTrackingToWebxrPoint([1, 0, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 1, 0])),
  new THREE.Vector3(...clientTrackingToWebxrPoint([0, 0, 1])),
);
export class ManipulationRenderer {
  readonly object = new THREE.Group();
  readonly handle = new EndEffectorHandleRenderer();
  private readonly pathStroke = new AdaptiveDashedLineRenderer();
  readonly path = this.pathStroke.object;
  private pathKey = "";
  private readonly boundStrokes = new Map<string, AdaptiveDashedLineRenderer>();
  private readonly bounds = new Map<string, THREE.Group>();
  private readonly ghosts = new Map<string, THREE.Object3D>();
  private readonly controls = new THREE.Group();
  private readonly status = new Text();
  private model: ManipulationModel | null = null;
  private disposed = false;
  private assetGeneration = 0;
  private assetMessage = "";
  hoveredLink: string | null = null;
  constructor() {
    this.object.name = "Manipulation";
    this.path.userData.environmentDepth = true;
    this.path.raycast = () => {};
    this.object.add(this.path, this.handle.object, this.controls);
    for (const [i, action] of [
      "plan",
      "execute",
      "cancel",
      "resume",
      "group",
      "gripper",
    ].entries()) {
      const button = new THREE.Mesh(
        new THREE.BoxGeometry(0.095, 0.045, 0.008),
        new THREE.MeshBasicMaterial({ color: 0x252c35, depthTest: false }),
      );
      button.position.set((i % 3) * 0.105, -Math.floor(i / 3) * 0.055, 0);
      button.userData.manipulationAction = action;
      button.userData.rayPriority = 5;
      registerRayTarget(button);
      const label = new Text();
      label.text = action[0].toUpperCase() + action.slice(1);
      label.font = UI_FONT_REGULAR;
      label.fontSize = 0.014;
      label.color = 0xffffff;
      label.anchorX = "center";
      label.anchorY = "middle";
      label.position.z = 0.006;
      (label.material as THREE.Material).depthTest = false;
      label.raycast = () => {};
      syncText(label);
      button.add(label);
      this.controls.add(button);
    }
    this.status.font = UI_FONT_REGULAR;
    this.status.fontSize = 0.014;
    this.status.maxWidth = 0.34;
    this.status.position.set(-0.05, 0.06, 0.01);
    this.status.raycast = () => {};
    (this.status.material as THREE.Material).depthTest = false;
    this.controls.add(this.status);
  }
  faceViewer(position: THREE.Vector3): void {
    this.controls.lookAt(position);
  }
  owns(object: THREE.Object3D): boolean {
    return (
      object === this.handle.collider ||
      !!object.userData.manipulationLink ||
      !!object.userData.manipulationAction
    );
  }
  apply(
    state: ManipulationState | null | undefined,
    origin: ClientTrackingOrigin | null,
    groupId: string | null,
    selected: boolean,
    target: ManipulationPose | null,
    solution: Record<string, number> | null,
    plan: ManipulationPlan | null,
    now: number,
    message: string,
    fresh = true,
    robotTitle = "Arm",
  ): void {
    this.object.visible = !!state?.available && !!origin;
    if (!this.object.visible || !state?.model || !origin) return;
    if (this.model?.revision !== state.model.revision)
      this.rebuild(state.model);
    const model = state.model,
      observed = groupId ? state.observations?.[groupId] : null;
    const all = Object.assign(
      {},
      ...Object.values(state.observations ?? {}).map((o) => o.joints ?? {}),
    );
    const rootPose =
      state.root_pose ??
      ({ position: [0, 0, 0], orientation: [0, 0, 0, 1] } as ManipulationPose);
    const measured = linkPoses(model, all);
    for (const link of model.links) {
      const box = this.bounds.get(link.name);
      if (!box) continue;
      this.place(box, composePose(rootPose, measured[link.name]), origin);
      this.boundStrokes
        .get(link.name)
        ?.setStyle(
          WORLD_DASH_STYLE.widthM,
          selected ? 0.9 : this.hoveredLink === link.name ? 0.8 : 0.5,
        );
    }
    const activePlan = plan ?? state.plan ?? null;
    const configuration = activePlan
      ? samplePlan(
          activePlan,
          activePlan.duration ? now % (activePlan.duration + 1) : 0,
        )
      : selected
        ? solution
        : null;
    const preview = configuration
      ? linkPoses(model, { ...all, ...configuration })
      : null;
    for (const [name, ghost] of this.ghosts) {
      ghost.visible = preview !== null;
      if (preview)
        this.place(ghost, composePose(rootPose, preview[name]), origin);
    }
    const group = state.groups?.find((g) => g.id === groupId);
    this.handle.collider.userData.interactionEnabled = fresh && !state.stopped;
    this.path.visible = !!activePlan && !!group?.tip_frame;
    const pathKey =
      activePlan && group?.tip_frame
        ? JSON.stringify([
            activePlan.plan_id,
            model.revision,
            group.tip_frame,
            origin,
            rootPose,
          ])
        : "";
    if (activePlan && group?.tip_frame && pathKey !== this.pathKey) {
      this.pathKey = pathKey;
      const points: THREE.Vector3[] = [];
      const count = Math.min(
        240,
        Math.max(2, Math.ceil(activePlan.duration * 30)),
      );
      for (let i = 0; i <= count; i++) {
        const pose = linkPoses(model, {
          ...all,
          ...samplePlan(activePlan, (activePlan.duration * i) / count),
        })[group.tip_frame];
        if (pose)
          points.push(
            new THREE.Vector3(
              ...clientTrackingToWebxrPose(
                odomToClientTrackingPose(composePose(rootPose, pose), origin),
              ).position,
            ),
          );
      }
      this.pathStroke.setSegments(
        points
          .slice(0, -1)
          .flatMap((point, i) => [
            point.toArray() as Vec3,
            points[i + 1].toArray() as Vec3,
          ]),
        true,
      );
    }
    this.handle.object.visible = !!observed?.pose;
    if (observed?.pose)
      this.place(
        this.handle.object,
        selected && target ? target : observed.pose,
        origin,
      );
    this.controls.visible = selected;
    this.place(
      this.controls,
      composePose(rootPose, {
        position: [0, -0.25, 0.35],
        orientation: [0, 0, 0, 1],
      }),
      origin,
    );
    for (const button of this.controls.children) {
      const action = button.userData.manipulationAction;
      button.userData.interactionEnabled =
        ["cancel", "group"].includes(action) || fresh;
      if (action === "plan")
        button.userData.interactionEnabled = fresh && target !== null;
      if (action === "execute") button.visible = !!plan;
      if (action === "resume") button.visible = state.stopped === true;
      if (action === "group") button.visible = (state.groups?.length ?? 0) > 1;
      if (action === "gripper") {
        button.visible = group?.has_gripper === true;
        button.userData.interactionEnabled = fresh && observed?.gripper != null;
        const label = button.children[0] as Text;
        const copy =
          observed?.gripper == null
            ? "Gripper —"
            : observed.gripper < 0.5
              ? "Open"
              : "Close";
        if (label.text !== copy) {
          label.text = copy;
          syncText(label);
        }
      }
    }
    const copy = `${robotTitle} · ${groupId ?? "Choose group"} · ${state.stopped ? (state.stop_confirmed ? "Stopped" : "Stop requested") : (state.execution ?? "")}\n${!fresh ? "Joint feedback is stale or unavailable" : message || "Select: plan · Unselect + grab: follow"}\nFollowing uses bounded IK; no checked path${this.assetMessage}`;
    if (this.status.text !== copy) {
      this.status.text = copy;
      syncText(this.status);
    }
  }
  private place(
    object: THREE.Object3D,
    pose: ManipulationPose | undefined,
    origin: ClientTrackingOrigin,
  ): void {
    if (!pose) {
      object.visible = false;
      return;
    }
    const converted = clientTrackingToWebxrPose(
      odomToClientTrackingPose(pose, origin),
    );
    object.position.fromArray(converted.position);
    object.quaternion.fromArray(converted.orientation);
  }
  private rebuild(model: ManipulationModel): void {
    this.clearModel();
    this.model = model;
    for (const link of model.links) {
      if (!link.bounds) continue;
      const group = new THREE.Group(),
        geometry = new THREE.BoxGeometry(...link.bounds.size);
      geometry.translate(...link.bounds.center);
      geometry.applyMatrix4(BASIS);
      const edges = new THREE.EdgesGeometry(geometry),
        positions = edges.getAttribute("position");
      const stroke = new AdaptiveDashedLineRenderer();
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
            this.disposeTree(gltf.scene);
            return;
          }
          if (
            model.visual_signature &&
            gltf.scene.userData.visual_signature !== model.visual_signature
          ) {
            this.disposeTree(gltf.scene);
            this.assetMessage =
              "\nPreview mesh does not match configured robot model";
            return;
          }
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
                part.geometry.applyMatrix4(BASIS);
                const old = Array.isArray(part.material)
                  ? part.material
                  : [part.material];
                old.forEach((m) => m.dispose());
                part.material = new THREE.MeshBasicMaterial({
                  color: 0x9fd5ff,
                  transparent: true,
                  opacity: 0.3,
                  depthWrite: false,
                  depthTest: false,
                });
              }
            });
            this.ghosts.set(link.name, node);
            this.object.add(node);
          }
          this.disposeTree(gltf.scene);
          this.assetMessage = "";
        },
        undefined,
        () => {
          if (generation === this.assetGeneration)
            this.assetMessage = "\nPreview mesh unavailable";
        },
      );
  }
  private disposeTree(root: THREE.Object3D): void {
    root.traverse((part) => {
      if (part instanceof Text) part.dispose();
      else if (part instanceof THREE.Mesh || part instanceof THREE.Line) {
        part.geometry.dispose();
        (Array.isArray(part.material)
          ? part.material
          : [part.material]
        ).forEach((m) => m.dispose());
      }
    });
    root.removeFromParent();
  }
  private clearModel(): void {
    this.assetGeneration++;
    this.pathKey = "";
    for (const stroke of this.boundStrokes.values()) stroke.dispose();
    this.boundStrokes.clear();
    for (const part of [...this.bounds.values(), ...this.ghosts.values()])
      this.disposeTree(part);
    this.bounds.clear();
    this.ghosts.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.clearModel();
    this.pathStroke.dispose();
    this.handle.dispose();
    this.disposeTree(this.object);
  }
}
