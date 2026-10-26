import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { robotOutlineFrame, FLOOR_MARKER_STYLE, ROBOT_LINE_STYLE, ROBOT_LABEL_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import type { StatusTone } from "../../DimOSARClient/websocket/sessionLinkStatus";
import type { RobotDescription } from "../../DimOSARClient/websocket/protocolTypes";
import { AdaptiveStrokeRenderer, WorldMeshRenderer, circleMesh, sphereMesh } from "./WorldMeshRenderer";
import { createText, COLOR_WHITE } from "./UIKit";

const LABEL_REGULAR = requireAsset("../../../Fonts/Inter/Inter-Regular.ttf") as Font;
const LABEL_SEMIBOLD = requireAsset("../../../Fonts/Inter/Inter-Semibold.ttf") as Font;
// Native LS 5.15 Inter advance calibration (64/128 point repeated-M probe).
const INTER_EM_PER_LINE = 0.8216;
const INTER_LINE_HEIGHT = 2478 / 2048;
const POSE_MATERIAL = requireAsset("../../../Materials/PoseIndicator.mat") as Material;

/** Body picking stays fixed while the visible outline unfolds from the floor. */
export class RobotWorldRenderer {
  readonly colliderRoot: SceneObject;
  readonly interactable: Interactable;
  private readonly collider: ColliderComponent;
  private readonly outline: AdaptiveStrokeRenderer;
  private readonly connector: AdaptiveStrokeRenderer;
  private readonly circle: WorldMeshRenderer;
  private readonly label: SceneObject;
  private readonly title: Text;
  private readonly dot: WorldMeshRenderer;
  private readonly status: Text;
  private readonly coordinates: Text;
  private labelKey = "";
  private selected = false;
  private hovered = false;
  private progress = 0;
  private selectionProgress = 0;
  private robot: RobotDescription | null = null;
  private floorShown = false;
  private opacity = FLOOR_MARKER_STYLE.idleOpacity as number;

  constructor(private readonly parent: SceneObject, toggle: (sourceId: string) => void) {
    const sphere = new WorldMeshRenderer(parent, "RobotIndicator", POSE_MATERIAL);
    const mesh = sphereMesh(3, 24, 16);
    sphere.triangles(mesh.positions, mesh.indices, [1, 1, 1, 1], undefined, mesh.normals);
    this.colliderRoot = global.scene.createSceneObject("RobotSelectionCollider"); this.colliderRoot.setParent(parent);
    this.collider = this.colliderRoot.createComponent("Physics.ColliderComponent") as ColliderComponent;
    this.collider.shape = Shape.createBoxShape();
    this.interactable = this.colliderRoot.createComponent(Interactable.getTypeName()) as Interactable;
    this.interactable.onTriggerStart.add(event => toggle(String(event.interactor.inputType)));
    this.outline = new AdaptiveStrokeRenderer(parent, "RobotSelectionOutline");
    this.connector = new AdaptiveStrokeRenderer(parent, "RobotFloorConnector");
    this.circle = new WorldMeshRenderer(parent, "RobotFloorCircle");
    this.label = global.scene.createSceneObject("RobotWorldLabel"); this.label.setParent(parent);
    const style = ROBOT_LABEL_STYLE;
    const label = (name: string, emM: number, xM: number, yM: number, widthM: number, font: Font, color: vec4, order: number): Text => {
      const text = createText({ parent: this.label, name, text: "", fontSize: emM * 100 * 32 / INTER_EM_PER_LINE,
        color, position: new vec3(xM * 100, yM * 100, 0.1), horizontalAlignment: HorizontalAlignment.Center,
        worldSpaceRect: Rect.create(-widthM * 50, widthM * 50, -20, 0) });
      text.font = font; text.sizeToFit = false; text.lineSpacing = INTER_LINE_HEIGHT * INTER_EM_PER_LINE;
      text.verticalAlignment = VerticalAlignment.Top; text.depthTest = true; text.setRenderOrder(order);
      return text;
    };
    this.title = label("RobotTitle", style.title.emM, style.title.xM, style.title.yM, style.title.widthM, LABEL_SEMIBOLD, COLOR_WHITE, 21);
    this.status = label("RobotActivity", style.activity.emM, 0, style.activity.yM, style.activity.widthM, LABEL_REGULAR, COLOR_WHITE, 22);
    this.coordinates = label("RobotCoordinates", style.detail.emM, 0, style.detail.yM, style.detail.widthM, LABEL_REGULAR, new vec4(0.68, 0.68, 0.7, 1), 22);
    this.dot = new WorldMeshRenderer(this.label, "RobotConnectionDot");
    this.dot.visual.setRenderOrder(20);

  }

  setRobot(robot: RobotDescription | null): void {
    this.robot = robot;
    this.colliderRoot.enabled = robot !== null;
    if (!robot) { this.reset(); this.connector.hide(); return; }
    (this.collider.shape as BoxShape).size = new vec3(robot.body_bounds_m[1] * 100, robot.body_bounds_m[2] * 100, robot.body_bounds_m[0] * 100);
    this.colliderRoot.getTransform().setLocalPosition(new vec3(0, (robot.body_bounds_m[2] / 2 - robot.base_height_m) * 100, 0));
  }
  setPickingEnabled(enabled: boolean): void { this.colliderRoot.enabled = enabled && this.robot !== null; }
  setSelected(selected: boolean): void { this.selected = selected; }
  setHovered(hovered: boolean): void { this.hovered = hovered; }
  ownsTarget(object: SceneObject): boolean {
    for (let node: SceneObject | null = object; node; node = node.getParent()) if (node === this.colliderRoot) return true;
    return false;
  }
  setFloorVisible(visible: boolean, opacity: number): void { this.floorShown = visible; this.opacity = opacity; }
  labels(title: string, status: string, coordinates: string, tone: StatusTone = "neutral"): void {
    const key = [title, status, coordinates, tone].join("\n");
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.title.text = title; this.status.text = status; this.coordinates.text = coordinates;
    this.coordinates.getSceneObject().enabled = coordinates.length > 0;
    const width = this.title.getBoundingBox().getSize().x;
    this.dot.object.getTransform().setLocalPosition(new vec3(-(width + ROBOT_LABEL_STYLE.dot.gapM * 100) / 2 + ROBOT_LABEL_STYLE.dot.radiusM * 100,
      ROBOT_LABEL_STYLE.dot.yM * 100, 0.1));
    const c = tone === "success" ? [0x30 / 255, 0xd1 / 255, 0x58 / 255] : tone === "warn" ? [1, 0x9f / 255, 0x0a / 255] :
      tone === "error" ? [1, 0x45 / 255, 0x3a / 255] : [0x8e / 255, 0x8e / 255, 0x93 / 255];
    const color: [number, number, number, number] = [c[0], c[1], c[2], 1];
    const positions = [0, 0, 0], indices: number[] = [];
    for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2, r = ROBOT_LABEL_STYLE.dot.radiusM * 100;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      if (i) indices.push(0, i, i + 1);
    }
    this.dot.triangles(positions, indices, color);
  }
  tick(dt: number, floor: { position: vec3; rotation: quat } | null, eye: vec3 | null, viewportHeight: number): void {
    if (!this.robot) return;
    this.progress = Math.max(0, Math.min(1, this.progress + (this.selected || this.hovered ? 1 : -1) * Math.max(0, dt) / 0.24));
    this.selectionProgress += ((this.selected ? 1 : 0) - this.selectionProgress) * (1 - Math.exp(-32 * Math.max(0, dt)));
    const frame = robotOutlineFrame(this.progress, this.selectionProgress);
    const [length, width, height] = this.robot.body_bounds_m.map(v => v * 100);
    const floorY = -this.robot.base_height_m * 100;
    const corners: [number, number, number][] = [];
    for (const y of [0, height]) for (const z of [-length / 2, length / 2]) for (const x of [-width / 2, width / 2]) {
      corners.push([x * frame.horizontal, floorY + y * frame.vertical, z * frame.horizontal]);
    }
    const edges = [[0, 1], [2, 3], [0, 2], [1, 3], [4, 5], [6, 7], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    this.outline.setViewportHeight(viewportHeight);
    if (frame.opacity > 0.001) this.outline.segments(edges.flatMap(([a, b]) => [corners[a], corners[b]]), frame.widthM * 100, frame.opacity,
      ROBOT_LINE_STYLE.dashM * 100, ROBOT_LINE_STYLE.gapM * 100);
    else this.outline.hide();
    const position = this.parent.getTransform().getWorldPosition();
    if (floor) {
      const ring = circleMesh(6, FLOOR_MARKER_STYLE.strokeM * 100);
      if (this.floorShown) {
        this.circle.triangles(ring.positions, ring.indices, [1, 1, 1, this.opacity]);
        this.circle.object.getTransform().setWorldPosition(new vec3(position.x, floor.position.y + 0.1, position.z));
        this.circle.object.getTransform().setWorldRotation(quat.quatIdentity());
      } else this.circle.hide();
      this.connector.object.getTransform().setWorldPosition(position);
      this.connector.object.getTransform().setWorldRotation(quat.quatIdentity());
      this.connector.setViewportHeight(viewportHeight);
      const bottom = Math.max(3, position.y - floor.position.y - 2);
      if (bottom > 3) this.connector.segments([[0, -3, 0], [0, -bottom, 0]], 0.275, 0.8);
      else this.connector.hide();
    }
    this.label.getTransform().setWorldPosition(position.add(new vec3(0, ROBOT_LABEL_STYLE.offsetYM * 100, 0)));
    if (eye) {
      const toward = eye.sub(this.label.getTransform().getWorldPosition());
      if (toward.length > 0.001) this.label.getTransform().setWorldRotation(quat.lookAt(toward.normalize(), vec3.up()));
    }
  }
  floorCircleBounds(floor: vec3) { return { center: [floor.x, floor.y + 0.1, floor.z] as [number, number, number], radius: 6 }; }
  reset(): void { this.progress = this.selectionProgress = 0; this.selected = this.hovered = false; this.outline.hide(); this.circle.hide(); }
}
