import * as THREE from "three";
import * as xb from "xrblocks";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import type { SpeechSnapshot } from "../agent/BrowserAgentSpeech";
import { toneCss } from "./tones";
import type { WebXRUISnapshot } from "./WebXRUIPresenter";

export type MainMenuCallbacks = {
  onSetup: () => void;
  onBack: () => void;
  onRetry: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onMode: () => void;
  onDebug: () => void;
  onLidar: () => void;
  onLocalize: () => void;
  onEstop: () => void;
  onAgentText: (text: string) => boolean;
};

const C = { ink: "#f5f5f5", muted: "#a3a3a3", faint: "#696969", surface: "#191919", line: "#383838", accent: "#ff8a24", dark: "#090909" };
const WIDTH = 0.9;
const HEIGHT = 0.68;

/** Authored text proportions stay consistent when the panel is resized. */
class SurfaceText extends xb.TextView {
  override updateLayout(): void {
    super.updateLayout();
    this.maxWidth = this.rangeX;
    if (this.textObj) {
      if (this.anchorX === "left") this.textObj.position.x = -this.rangeX / 2;
      this.textObj.raycast = () => {};
      this.createTextSDF();
    }
  }

  color(color: string): void {
    if (this.fontColor === color) return;
    this.fontColor = color;
    this.setTextColor(color);
  }
}

class SurfaceButton extends xb.TextButton {
  enabled = true;
  private baseColor = new THREE.Color(C.surface);
  private primary = false;

  setSurface(background: string, primary: boolean): void {
    this.primary = primary;
    this.baseColor.set(background);
    const mesh = this.mesh!;
    (mesh.material as THREE.Material).dispose();
    mesh.material = new THREE.MeshBasicMaterial({ color: this.baseColor, depthWrite: false });
    mesh.geometry.dispose();
    mesh.geometry = new THREE.ShapeGeometry(roundedShape(this.rangeX, this.rangeY, 0.16));
    mesh.name = `Button: ${this.text}`;
    registerRayTarget(mesh);
    this.setEnabled(true);
  }

  override updateLayout(): void {
    super.updateLayout();
    // Physical geometry avoids the package's shared button shader state.
    this.mesh?.scale.set(1, 1, 1);
    this.maxWidth = this.rangeX * 0.88;
    if (this.textObj) this.createTextSDF();
  }

  override update(): void {
    const material = this.mesh?.material as THREE.MeshBasicMaterial;
    if (!material?.color) return;
    material.color.copy(this.baseColor);
    if (!this.enabled) material.color.multiplyScalar(0.6);
    else if (this.ux.isHovered()) material.color.lerp(new THREE.Color("#ffffff"), this.ux.isSelected() ? 0.24 : 0.12);
    this.setTextColor(this.fontColor);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.fontColor = enabled ? (this.primary ? C.dark : C.ink) : C.faint;
  }

  setActive(active: boolean): void {
    this.primary = active;
    this.baseColor.set(active ? C.accent : C.surface);
    this.fontColor = this.enabled ? (active ? C.dark : C.ink) : C.faint;
  }
}

export class MainMenuView {
  readonly panel: xb.SpatialPanel;
  private readonly wizard = new THREE.Group();
  private readonly console = new THREE.Group();
  private readonly keyboard = new THREE.Group();
  private readonly details = new THREE.Group();
  private readonly title: SurfaceText;
  private readonly description: SurfaceText;
  private readonly status: SurfaceText;
  private readonly cardTitle: SurfaceText;
  private readonly cardBody: SurfaceText;
  private readonly cardIcon: SurfaceText;
  private readonly stepLabels: SurfaceText[] = [];
  private readonly stepLines: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly setup: SurfaceButton;
  private readonly back: SurfaceButton;
  private readonly retry: SurfaceButton;
  private readonly robotName: SurfaceText;
  private readonly activity: SurfaceText;
  private readonly hud: SurfaceText;
  private readonly agent: SurfaceText;
  private readonly mode: SurfaceButton;
  private readonly lidar: SurfaceButton;
  private readonly localize: SurfaceButton;
  private readonly estop: SurfaceButton;
  private readonly type: SurfaceButton;
  private readonly debug: SurfaceText;
  private readonly typed: SurfaceText;
  private manipulation: {
    plane: THREE.Plane; start: THREE.Vector3; position: THREE.Vector3;
    anchor: THREE.Vector3; span: THREE.Vector3; scale: number; distance: number; resize: boolean;
    rotation: THREE.Quaternion; controllerInverse: THREE.Quaternion;
  } | null = null;
  private draft = "";
  private agentEnabled = false;

  constructor(handlers: MainMenuCallbacks) {
    this.panel = new xb.SpatialPanel({ width: WIDTH, height: HEIGHT, backgroundColor: C.dark, draggable: false, useDefaultPosition: false, useBorderlessShader: true });
    this.panel.name = "DimOS control panel";
    this.panel.mesh.uniforms.uRadius.value = 0.032;
    this.panel.add(this.wizard, this.console, this.keyboard, this.details);
    const plate = rect(this.panel, 0, 0, WIDTH, HEIGHT, C.dark, 0.032, 0.001);
    plate.raycast = THREE.Mesh.prototype.raycast;
    plate.name = "Menu background";
    registerRayTarget(plate);

    rect(this.panel, -0.36, 0.29, 0.026, 0.026, C.accent, 0.013);
    label(this.panel, "DimOS ARModule", -0.19, 0.29, 0.28, 0.027, 19);
    this.status = label(this.panel, "Not connected", 0.18, 0.29, 0.38, 0.026, 17, C.muted, "center");
    rect(this.panel, 0, 0.25, 0.816, 0.001, C.line);

    for (let i = 0; i < 2; i++) {
      const x = -0.2 + i * 0.4;
      this.stepLines.push(rect(this.wizard, x, 0.207, 0.38, 0.004, C.line));
      this.stepLabels.push(label(this.wizard, ["01  CONNECT", "02  ALIGN"][i], x, 0.176, 0.38, 0.025, 15, C.muted));
    }
    this.title = label(this.wizard, "Connect", 0, 0.108, 0.816, 0.056, 36);
    this.description = label(this.wizard, "", 0, 0.04, 0.8, 0.06, 20, C.muted);
    rect(this.wizard, 0, -0.083, 0.816, 0.15, C.surface, 0.016);
    rect(this.wizard, -0.345, -0.08, 0.062, 0.062, C.line, 0.014, 0.012);
    this.cardIcon = label(this.wizard, "01", -0.345, -0.08, 0.054, 0.045, 25, C.accent, "center");
    this.cardTitle = label(this.wizard, "Ready when you are", 0.055, -0.052, 0.60, 0.03, 24);
    this.cardBody = label(this.wizard, "", 0.055, -0.109, 0.60, 0.062, 18, C.muted);
    this.back = button(this.wizard, "Back", -0.32, -0.24, 0.16, 0.054, handlers.onBack);
    this.retry = button(this.wizard, "Retry", -0.095, -0.24, 0.19, 0.054, () => this.lastStep === "localization" ? handlers.onLocalize() : handlers.onRetry());
    this.setup = button(this.wizard, "Next", 0.258, -0.24, 0.28, 0.06, handlers.onSetup, true);
    label(this.wizard, "Grab header to move and rotate · Drag an edge to resize", 0, -0.317, 0.816, 0.023, 14, C.faint, "center");
    rect(this.panel, 0, -0.327, 0.11, 0.005, C.muted, 0.002, 0.012);
    for (const side of [-1, 1]) {
      rect(this.panel, side * 0.437, 0, 0.004, 0.09, C.muted, 0.002, 0.012);
    }

    this.robotName = label(this.console, "Robot control", -0.1, 0.205, 0.62, 0.045, 32);
    button(this.console, "Close", 0.33, 0.205, 0.14, 0.045, handlers.onMenu);
    this.activity = label(this.console, "Idle", 0, 0.15, 0.816, 0.028, 18, C.muted);
    this.mode = button(this.console, "Manual control", -0.205, 0.078, 0.39, 0.066, handlers.onMode);
    this.type = button(this.console, "Message agent", 0.205, 0.078, 0.39, 0.066, () => { if (this.agentEnabled) this.keyboard.visible = true; });
    rect(this.console, 0, -0.025, 0.816, 0.105, C.surface, 0.014);
    this.agent = label(this.console, "", 0, -0.025, 0.76, 0.09, 19, C.muted);
    this.lidar = button(this.console, "LiDAR · Obstacles", -0.28, -0.135, 0.25, 0.056, handlers.onLidar);
    this.localize = button(this.console, "Realign", 0, -0.135, 0.25, 0.056, handlers.onLocalize);
    button(this.console, "Diagnostics", 0.28, -0.135, 0.25, 0.056, () => { handlers.onDebug(); this.details.visible = !this.details.visible; });
    this.hud = label(this.console, "", 0, -0.187, 0.816, 0.03, 16, C.muted);
    this.estop = button(this.console, "EMERGENCY STOP", -0.11, -0.26, 0.58, 0.058, handlers.onEstop, false, C.surface);
    button(this.console, "Setup", 0.32, -0.26, 0.17, 0.058, handlers.onRestart);
    label(this.console, "Grip to move and rotate · Drag an edge to resize", 0, -0.317, 0.816, 0.023, 14, C.faint, "center");

    // Secondary surfaces occupy the content area rather than squeezing the console.
    rect(this.keyboard, 0, -0.028, 0.86, 0.52, C.dark, 0.018, 0.014);
    label(this.keyboard, "Message your agent", -0.08, 0.205, 0.64, 0.035, 27);
    button(this.keyboard, "Done", 0.34, 0.205, 0.14, 0.045, () => { this.keyboard.visible = false; });
    rect(this.keyboard, 0, 0.104, 0.736, 0.06, C.surface, 0.009, 0.018);
    this.typed = label(this.keyboard, "Type a message", 0, 0.104, 0.69, 0.05, 20);
    for (const [row, letters] of ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm.,?"].entries()) {
      const pitch = 0.072;
      for (const [col, letter] of [...letters].entries()) {
        button(this.keyboard, letter, (col - (letters.length - 1) / 2) * pitch, 0.025 - row * 0.062, 0.064, 0.052, () => this.setDraft(this.draft + letter));
      }
    }
    button(this.keyboard, "Space", -0.226, -0.229, 0.28, 0.05, () => this.setDraft(this.draft + " "));
    button(this.keyboard, "Delete", 0.046, -0.229, 0.236, 0.05, () => this.setDraft(this.draft.slice(0, -1)));
    button(this.keyboard, "Send", 0.274, -0.229, 0.188, 0.05, () => { if (handlers.onAgentText(this.draft)) { this.setDraft(""); this.keyboard.visible = false; } }, true);

    rect(this.details, 0, -0.028, 0.86, 0.52, C.dark, 0.018, 0.014);
    label(this.details, "Diagnostics", -0.08, 0.205, 0.64, 0.035, 27);
    button(this.details, "Done", 0.34, 0.205, 0.14, 0.045, () => { handlers.onDebug(); this.details.visible = false; });
    this.debug = label(this.details, "", 0, -0.035, 0.71, 0.32, 17, C.muted);
    this.console.visible = false;
    this.keyboard.visible = false;
    this.details.visible = false;
    this.panel.scale.multiplyScalar(0.6);
  }

  private lastStep: WebXRUISnapshot["wizardStep"] = "connect";

  apply(snap: WebXRUISnapshot, speech?: SpeechSnapshot): void {
    this.lastStep = snap.wizardStep;
    this.agentEnabled = snap.setupCompleted && snap.operatingMode === "agent" && snap.agentAvailable;
    this.panel.visible = snap.menuOpen || !snap.setupCompleted;
    this.wizard.visible = !snap.setupCompleted;
    if (!this.agentEnabled || !this.panel.visible) this.keyboard.visible = false;
    if (!snap.setupCompleted || !this.panel.visible) this.details.visible = false;
    this.console.visible = snap.setupCompleted && !this.keyboard.visible && !this.details.visible;
    this.status.color(toneCss(snap.connectionTone));
    setText(this.status, snap.connectionText);
    setText(this.title, snap.wizardTitle);
    setText(this.description, snap.wizardDescription);
    const index = ["connect", "localization"].indexOf(snap.wizardStep);
    this.stepLabels.forEach((text, i) => text.color(i === index ? C.accent : i < index ? C.ink : C.faint));
    this.stepLines.forEach((mesh, i) => mesh.material.color.set(i <= index ? C.accent : C.line));
    setText(this.cardIcon, snap.localizationIssue && index === 1 ? "!" : `0${index + 1}`);
    this.cardIcon.color(C.accent);
    setText(this.cardTitle, snap.wizardCardTitle);
    setText(this.cardBody, clip(snap.wizardCardBody, 180));
    this.cardTitle.color(C.ink);
    setText(this.setup, snap.nextLabel);
    this.back.visible = snap.backVisible;
    this.retry.visible = index === 0 || (index === 1 && !!snap.localizationIssue);
    setText(this.retry, index === 1 ? "Try again" : "Reconnect");
    setText(this.robotName, snap.robotName || "Robot control");
    setText(this.activity, `${snap.operatingMode === "agent" && speech?.status !== "Off" ? speech?.status ?? snap.activity : snap.activity}  ·  ${snap.hasTrackingOrigin ? "Spatial alignment active" : "Spatial navigation unavailable"}`);
    setText(this.mode, snap.operatingMode === "agent" ? "Agent mode" : "Manual mode");
    this.mode.setEnabled(snap.agentAvailable);
    this.mode.setActive(snap.operatingMode === "manual");
    this.type.setEnabled(this.agentEnabled);
    this.type.setActive(snap.operatingMode === "agent");
    setText(this.type, this.agentEnabled ? "Message agent" : "Select Agent to chat");
    setText(this.agent, clip([speech?.prompt, speech?.response || snap.agentMessage, speech?.error].filter(Boolean).join("\n") || (this.agentEnabled ? "Say the wake word or type a message to begin." : "Place a target on the floor, drag to set its heading, then release."), 190));
    this.agent.color(toneCss(speech?.severity === "error" ? "error" : speech?.severity === "warn" ? "warn" : "neutral"));
    setText(this.lidar, snap.lidarAvailable ? `LiDAR · ${snap.lidarMode}` : "LiDAR unavailable");
    this.lidar.setEnabled(snap.lidarAvailable);
    setText(this.localize, snap.hasTrackingOrigin ? "Realign" : "Align robot");
    this.estop.setEnabled(snap.estopAvailable);
    setText(this.hud, clip(snap.hudText || (!snap.hasTrackingOrigin ? "Align the robot to enable spatial targets and routes." : ""), 100));
    this.hud.color(toneCss(snap.hudTone ?? "muted"));
    setText(this.debug, snap.debugText);
  }

  ownsTarget(object: THREE.Object3D | undefined): boolean {
    for (let node = object; node; node = node.parent ?? undefined) {
      if (node === this.panel) return true;
    }
    return false;
  }

  private setDraft(text: string): void {
    this.draft = text.slice(0, 500);
    setText(this.typed, clip(this.draft, 66) || "Type a message");
  }

  beginManipulation(origin: Vec3, direction: Vec3, rotation = new THREE.Quaternion(), grip = false): boolean {
    if (!this.panel.visible) return false;
    this.panel.updateWorldMatrix(true, true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.panel.getWorldQuaternion(new THREE.Quaternion()));
    const center = this.panel.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
    const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    const start = ray.intersectPlane(plane, new THREE.Vector3());
    if (!start) return false;
    const local = this.panel.worldToLocal(start.clone());
    const halfWidth = WIDTH / HEIGHT / 2, halfHeight = 0.5;
    const edgeX = Math.abs(local.x) > halfWidth - 0.035 / HEIGHT;
    const edgeY = Math.abs(local.y) > halfHeight - 0.025 / HEIGHT;
    if (Math.abs(local.x) > halfWidth + 0.02 || Math.abs(local.y) > halfHeight + 0.02) return false;
    const bottomGrip = Math.abs(local.x) < 0.1 / HEIGHT && local.y < -0.3 / HEIGHT;
    const resize = !grip && (edgeX || edgeY) && !bottomGrip;
    if (!grip && !resize && local.y < 0.25 / HEIGHT && local.y > -0.3 / HEIGHT) return false;
    const anchor = this.panel.localToWorld(new THREE.Vector3(
      edgeX ? -Math.sign(local.x) * halfWidth : 0,
      edgeY ? -Math.sign(local.y) * halfHeight : 0, 0,
    ));
    this.manipulation = {
      plane, start, position: this.panel.position.clone(), anchor,
      span: start.clone().sub(anchor), scale: this.panel.scale.x,
      distance: start.distanceTo(ray.origin), resize,
      rotation: this.panel.quaternion.clone(), controllerInverse: rotation.clone().invert(),
    };
    return true;
  }

  updateManipulation(origin: Vec3, direction: Vec3, rotation = new THREE.Quaternion(), deltaS = 1 / 60): void {
    const state = this.manipulation;
    if (!state) return;
    const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    if (!state.resize) {
      const deltaRotation = rotation.clone().multiply(state.controllerInverse);
      const targetRotation = deltaRotation.clone().multiply(state.rotation);
      const offset = state.start.clone().sub(state.position).applyQuaternion(deltaRotation);
      const targetPosition = ray.at(state.distance, new THREE.Vector3()).sub(offset);
      this.panel.position.lerp(targetPosition, 1 - Math.exp(-12 * deltaS));
      this.panel.quaternion.slerp(targetRotation, 1 - Math.exp(-8 * deltaS));
      return;
    }
    const point = ray.intersectPlane(state.plane, new THREE.Vector3());
    if (!point || state.span.lengthSq() < 1e-8) return;
    const ratio = point.sub(state.anchor).dot(state.span) / state.span.lengthSq();
    const scale = THREE.MathUtils.clamp(state.scale * ratio, HEIGHT * 0.3, HEIGHT * 1.5);
    this.panel.scale.setScalar(scale);
    this.panel.position.copy(state.position).sub(state.anchor).multiplyScalar(scale / state.scale).add(state.anchor);
  }

  endManipulation(): void { this.manipulation = null; }

}

function attach<T extends xb.TextView>(parent: THREE.Object3D, object: T, x: number, y: number): T {
  object.isRoot = true;
  object.renderOrder = 12;
  parent.add(object);
  object.updateLayouts();
  object.position.set(x / HEIGHT, y / HEIGHT, 0.025 / HEIGHT);
  return object;
}

function label(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string = C.ink, align: "left" | "center" = "left"): SurfaceText {
  const target = new SurfaceText({ text, fontSize: xb.TextView.dpToMeters(fontSize * 1.35) / height, fontColor: color, selectable: false, mode: "center", anchorX: align, textAlign: align });
  target.width = width / HEIGHT;
  target.height = height / HEIGHT;
  return attach(parent, target, x, y);
}

function button(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, action: () => void, primary = false, background = C.surface): SurfaceButton {
  const target = attach(parent, new SurfaceButton({ text, width: width / HEIGHT, height: height / HEIGHT, fontSize: xb.TextView.dpToMeters(28) / height, opacity: 1, backgroundColor: primary ? C.accent : background, radius: 0.016, hoverColor: C.accent, selectedFontColor: "#ffffff" }), x, y);
  target.setSurface(primary ? C.accent : background, primary);
  target.onTriggered = () => {
    if (!target.enabled) return;
    // XR Blocks also intersects hidden descendants, so check the entire ancestry.
    let node: THREE.Object3D | null = target;
    while (node) { if (!node.visible) return; node = node.parent; }
    action();
  };
  return target;
}

function rect(parent: THREE.Object3D, x: number, y: number, width: number, height: number, color: string, radius = 0.001, z = 0.006): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(width, height, radius)), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  mesh.position.set(x / HEIGHT, y / HEIGHT, z / HEIGHT);
  mesh.scale.setScalar(1 / HEIGHT);
  mesh.raycast = () => {};
  parent.add(mesh);
  return mesh;
}

function roundedShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const w = width / 2, h = height / 2, r = Math.min(radius, w, h);
  shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r); shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h); shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r); shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

function setText(target: xb.TextView, value: string): void {
  if (target.text !== value) target.setText(value);
}
function clip(text: string, max: number): string { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
