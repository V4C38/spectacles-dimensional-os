import * as THREE from "three";
import * as xb from "xrblocks";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { markRayPassive, registerRayTarget } from "../input/XRBlocksRayInteraction";
import { UI_FONT_REGULAR, UI_FONT_SEMIBOLD } from "./fonts";
import { GlassSurface, glassMaterial } from "./glassMaterial";
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
  onRealign: () => void;
  onEstop: () => void;
  onAgentText: (text: string) => boolean;
};

// Apple dark-appearance system colors. Only the window glass is translucent;
// every surface placed on it is opaque.
const C = {
  ink: "#ffffff", muted: "#aeaeb2", faint: "#8e8e93", disabled: "#636366",
  fill: "#2c2c2e", control: "#3a3a3c", field: "#1c1c1e", separator: "#38383a",
  accent: "#0a84ff", danger: "#ff453a", chrome: "#d1d1d6",
};
const WIDTH = 0.9;
const HEIGHT = 0.68;
const RADIUS = 0.05;
const MARGIN = 0.04;
const CONTENT = WIDTH - MARGIN * 2;
const LEFT = -CONTENT / 2;
const MAX_PITCH = THREE.MathUtils.degToRad(60);

type ButtonVariant = "default" | "primary" | "danger";
type Align = "left" | "center" | "right";
type Zone = "bar" | "left" | "right" | "body";

/** Authored text proportions stay consistent when the panel is resized. */
class SurfaceText extends xb.TextView {
  override updateLayout(): void {
    super.updateLayout();
    this.maxWidth = this.rangeX;
    if (this.textObj) {
      if (this.anchorX === "left") this.textObj.position.x = -this.rangeX / 2;
      if (this.anchorX === "right") this.textObj.position.x = this.rangeX / 2;
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
  private variant: ButtonVariant = "default";
  private active = false;
  private hover = 0;
  private baseZ = 0;

  setSurface(variant: ButtonVariant): void {
    this.variant = variant;
    const mesh = this.mesh!;
    (mesh.material as THREE.Material).dispose();
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(this.rangeX, this.rangeY);
    mesh.material = glassMaterial({ width: this.rangeX, height: this.rangeY, radius: this.rangeY / 2, tint: C.control, alpha: 1, rim: 0.08, rimWidth: 0.002 / HEIGHT });
    mesh.name = `Button: ${this.text}`;
    registerRayTarget(mesh);
    this.baseZ = this.position.z;
    this.setEnabled(true);
  }

  override updateLayout(): void {
    super.updateLayout();
    // Physical geometry avoids the package's shared button shader state.
    this.mesh?.scale.set(1, 1, 1);
    this.maxWidth = this.rangeX * 0.86;
    if (this.textObj) this.createTextSDF();
  }

  override update(): void {
    const uniforms = (this.mesh?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (!uniforms?.uHover) return;
    const target = !this.enabled || !this.ux.isHovered() ? 0 : this.ux.isSelected() ? 1.6 : 1;
    this.hover += (target - this.hover) * 0.25;
    uniforms.uHover.value = this.hover;
    this.position.z = this.baseZ + Math.min(this.hover, 1) * 0.004 / HEIGHT;
    this.setTextColor(this.fontColor);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled && this.mesh?.userData.styled) return;
    this.enabled = enabled;
    this.restyle();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.restyle();
  }

  private restyle(): void {
    const uniforms = (this.mesh?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    const surface = !this.enabled ? C.fill : this.variant === "danger" ? C.danger :
      this.variant === "primary" || this.active ? C.accent : C.control;
    if (uniforms?.uTint) {
      uniforms.uTint.value.set(surface);
      this.mesh!.userData.styled = true;
    }
    this.fontColor = this.enabled ? C.ink : C.disabled;
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
  private readonly statusDot: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
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
  private readonly bar: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly barZone: THREE.Mesh;
  private readonly cornerArcs: Record<"left" | "right", THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  private readonly cornerZones: Record<"left" | "right", THREE.Mesh>;
  private manipulation: {
    plane: THREE.Plane; start: THREE.Vector3; position: THREE.Vector3;
    anchor: THREE.Vector3; span: THREE.Vector3; scale: number; distance: number; resize: boolean;
    rotation: THREE.Quaternion; controllerInverse: THREE.Quaternion; zone: Zone;
  } | null = null;
  private draft = "";
  private agentEnabled = false;

  constructor(handlers: MainMenuCallbacks) {
    this.panel = new xb.SpatialPanel({ width: WIDTH, height: HEIGHT, backgroundColor: "#00000000", draggable: false, useDefaultPosition: false, useBorderlessShader: true });
    this.panel.name = "DimOS control panel";
    // The glass plate replaces the package's opaque panel background.
    this.panel.mesh.visible = false;
    this.panel.add(this.wizard, this.console, this.keyboard, this.details);
    const plate = new GlassSurface({ width: WIDTH, height: HEIGHT, radius: RADIUS, rim: 0.28, rimWidth: 0.0025 });
    place(this.panel, plate, 0, 0, 0.001);
    plate.renderOrder = 1;
    plate.name = "Menu background";
    registerRayTarget(plate);
    markRayPassive(plate);

    // Header, shared by every page.
    this.statusDot = rect(this.panel, LEFT + 0.009, 0.29, 0.018, 0.018, C.faint, 0.009);
    label(this.panel, "DimOS ARModule", LEFT + 0.03 + 0.15, 0.29, 0.3, 0.03, 20, C.ink, "left", "semibold");
    this.status = label(this.panel, "Not connected", -LEFT - 0.2, 0.29, 0.4, 0.028, 17, C.muted, "right");
    rect(this.panel, 0, 0.256, CONTENT, 0.002, C.separator, 0.001);

    for (let i = 0; i < 2; i++) {
      const x = (i ? 1 : -1) * (CONTENT / 4 + 0.005);
      this.stepLines.push(rect(this.wizard, x, 0.222, CONTENT / 2 - 0.01, 0.004, C.separator, 0.002));
      this.stepLabels.push(label(this.wizard, ["01  CONNECT", "02  ALIGN"][i], x, 0.196, CONTENT / 2 - 0.01, 0.026, 15, C.faint, "left", "semibold"));
    }
    this.title = label(this.wizard, "Connect", 0, 0.135, CONTENT, 0.06, 38, C.ink, "left", "semibold");
    this.description = label(this.wizard, "", 0, 0.075, CONTENT, 0.05, 20, C.muted);
    surface(this.wizard, 0, -0.045, CONTENT, 0.17, 0.028, C.fill);
    surface(this.wizard, LEFT + 0.06, -0.045, 0.064, 0.064, 0.032, C.control);
    this.cardIcon = label(this.wizard, "01", LEFT + 0.06, -0.045, 0.056, 0.045, 24, C.accent, "center", "semibold");
    const cardText = CONTENT - 0.12 - 0.028;
    this.cardTitle = label(this.wizard, "Ready when you are", LEFT + 0.12 + cardText / 2, -0.012, cardText, 0.032, 24, C.ink, "left", "semibold");
    this.cardBody = label(this.wizard, "", LEFT + 0.12 + cardText / 2, -0.07, cardText, 0.064, 19, C.muted);
    this.back = button(this.wizard, "Back", LEFT + 0.08, -0.19, 0.16, 0.064, handlers.onBack);
    this.retry = button(this.wizard, "Retry", LEFT + 0.18 + 0.11, -0.19, 0.22, 0.064, () => this.lastStep === "localization" ? handlers.onLocalize() : handlers.onRetry());
    this.setup = button(this.wizard, "Next", -LEFT - 0.14, -0.19, 0.28, 0.064, handlers.onSetup, "primary");
    label(this.wizard, "Drag the bar to move · Drag a corner to resize", 0, -0.29, CONTENT, 0.025, 15, C.faint, "center");

    this.robotName = label(this.console, "Robot control", LEFT + 0.33, 0.208, 0.66, 0.048, 32, C.ink, "left", "semibold");
    button(this.console, "Close", -LEFT - 0.06, 0.208, 0.12, 0.052, handlers.onMenu);
    this.activity = label(this.console, "Idle", 0, 0.162, CONTENT, 0.03, 19, C.muted);
    const half = (CONTENT - 0.02) / 2;
    this.mode = button(this.console, "Manual control", LEFT + half / 2, 0.098, half, 0.068, handlers.onMode);
    this.type = button(this.console, "Message agent", -LEFT - half / 2, 0.098, half, 0.068, () => { if (this.agentEnabled) this.keyboard.visible = true; });
    surface(this.console, 0, -0.006, CONTENT, 0.11, 0.024, C.fill);
    this.agent = label(this.console, "", 0, -0.006, CONTENT - 0.056, 0.094, 20, C.muted);
    const third = (CONTENT - 0.04) / 3;
    this.lidar = button(this.console, "LiDAR · Obstacles", LEFT + third / 2, -0.11, third, 0.064, handlers.onLidar);
    this.localize = button(this.console, "Realign", 0, -0.11, third, 0.064, handlers.onRealign);
    button(this.console, "Diagnostics", -LEFT - third / 2, -0.11, third, 0.064, () => { handlers.onDebug(); this.details.visible = !this.details.visible; });
    this.hud = label(this.console, "", 0, -0.166, CONTENT, 0.028, 17, C.muted);
    this.estop = button(this.console, "EMERGENCY STOP", LEFT + 0.3, -0.226, 0.6, 0.066, handlers.onEstop, "danger");
    button(this.console, "Setup", -LEFT - 0.1, -0.226, 0.2, 0.066, handlers.onRestart);
    label(this.console, "Drag the bar to move · Drag a corner to resize", 0, -0.29, CONTENT, 0.025, 15, C.faint, "center");

    // Secondary pages occupy the content area; the console is hidden behind them.
    label(this.keyboard, "Message your agent", LEFT + 0.33, 0.208, 0.66, 0.04, 28, C.ink, "left", "semibold");
    button(this.keyboard, "Done", -LEFT - 0.06, 0.208, 0.12, 0.052, () => { this.keyboard.visible = false; });
    surface(this.keyboard, 0, 0.13, CONTENT, 0.066, 0.033, C.field);
    this.typed = label(this.keyboard, "Type a message", 0, 0.13, CONTENT - 0.06, 0.05, 20);
    const pitch = CONTENT / 10;
    for (const [row, letters] of ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm.,?"].entries()) {
      for (const [col, letter] of [...letters].entries()) {
        button(this.keyboard, letter, (col - (letters.length - 1) / 2) * pitch, 0.05 - row * 0.064, pitch - 0.01, 0.054, () => this.setDraft(this.draft + letter));
      }
    }
    button(this.keyboard, "Space", LEFT + 0.18, -0.222, 0.36, 0.058, () => this.setDraft(this.draft + " "));
    button(this.keyboard, "Delete", LEFT + 0.38 + 0.11, -0.222, 0.22, 0.058, () => this.setDraft(this.draft.slice(0, -1)));
    button(this.keyboard, "Send", -LEFT - 0.1, -0.222, 0.2, 0.058, () => { if (handlers.onAgentText(this.draft)) { this.setDraft(""); this.keyboard.visible = false; } }, "primary");

    label(this.details, "Diagnostics", LEFT + 0.33, 0.208, 0.66, 0.04, 28, C.ink, "left", "semibold");
    button(this.details, "Done", -LEFT - 0.06, 0.208, 0.12, 0.052, () => { handlers.onDebug(); this.details.visible = false; });
    surface(this.details, 0, -0.03, CONTENT, 0.4, 0.028, C.fill);
    this.debug = label(this.details, "", 0, -0.03, CONTENT - 0.056, 0.36, 18, C.muted);

    // visionOS-style window controls sit outside the glass.
    this.bar = rect(this.panel, 0, -HEIGHT / 2 - 0.026, 0.12, 0.013, C.chrome, 0.0065);
    this.bar.material.opacity = 0.6;
    this.barZone = zone(this.panel, "Window bar", 0, -HEIGHT / 2 - 0.026, 0.22, 0.05);
    const arc = (side: -1 | 1) => {
      const geometry = new THREE.RingGeometry(RADIUS + 0.012, RADIUS + 0.019, 24, 1, side > 0 ? -Math.PI / 2 : Math.PI, Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: C.chrome, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      place(this.panel, mesh, side * (WIDTH / 2 - RADIUS), -(HEIGHT / 2 - RADIUS), 0.006);
      mesh.raycast = () => {};
      return mesh;
    };
    this.cornerArcs = { left: arc(-1), right: arc(1) };
    this.cornerZones = {
      left: zone(this.panel, "Resize corner", -WIDTH / 2, -HEIGHT / 2, 0.09, 0.09),
      right: zone(this.panel, "Resize corner", WIDTH / 2, -HEIGHT / 2, 0.09, 0.09),
    };

    this.console.visible = false;
    this.keyboard.visible = false;
    this.details.visible = false;
    this.panel.scale.multiplyScalar(0.72);
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
    this.statusDot.material.color.set(toneCss(snap.connectionTone));
    setText(this.status, snap.connectionText);
    setText(this.title, snap.wizardTitle);
    setText(this.description, snap.wizardDescription);
    const index = ["connect", "localization"].indexOf(snap.wizardStep);
    this.stepLabels.forEach((text, i) => text.color(i === index ? C.accent : i < index ? C.ink : C.faint));
    this.stepLines.forEach((mesh, i) => mesh.material.color.set(i <= index ? C.accent : C.separator));
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

  updateHover(hits: (THREE.Object3D | undefined)[], deltaS: number): void {
    const zone = this.manipulation?.zone;
    const looking = !!zone || hits.some(hit => this.ownsTarget(hit));
    const k = 1 - Math.exp(-14 * deltaS);
    for (const side of ["left", "right"] as const) {
      const material = this.cornerArcs[side].material;
      const target = zone === side || hits.includes(this.cornerZones[side]) ? 1 : looking ? 0.35 : 0;
      material.opacity += (target - material.opacity) * k;
    }
    const barActive = zone === "bar" || hits.includes(this.barZone);
    this.bar.material.opacity += ((barActive ? 1 : 0.6) - this.bar.material.opacity) * k;
    this.bar.scale.x += ((barActive ? 1.3 : 1) / HEIGHT - this.bar.scale.x) * k;
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
    const u = (meters: number) => meters / HEIGHT;
    const halfWidth = WIDTH / HEIGHT / 2, halfHeight = 0.5;
    const inside = Math.abs(local.x) <= halfWidth && Math.abs(local.y) <= halfHeight;
    const corner = Math.abs(local.x) > halfWidth - u(0.05) && Math.abs(local.x) < halfWidth + u(0.045) &&
      local.y < -halfHeight + u(0.05) && local.y > -halfHeight - u(0.045);
    const bar = Math.abs(local.x) < u(0.11) && local.y < -halfHeight && local.y > -halfHeight - u(0.05);
    const resize = corner && !grip;
    const move = !resize && (bar || (inside && (grip || local.y > u(0.25))));
    if (!resize && !move) return false;
    const anchor = this.panel.localToWorld(new THREE.Vector3(resize ? -Math.sign(local.x) * halfWidth : 0, resize ? halfHeight : 0, 0));
    this.manipulation = {
      plane, start, position: this.panel.position.clone(), anchor,
      span: start.clone().sub(anchor), scale: this.panel.scale.x,
      distance: start.distanceTo(ray.origin), resize,
      rotation: this.panel.quaternion.clone(), controllerInverse: rotation.clone().invert(),
      zone: resize ? (local.x < 0 ? "left" : "right") : bar ? "bar" : "body",
    };
    return true;
  }

  updateManipulation(origin: Vec3, direction: Vec3, rotation = new THREE.Quaternion(), deltaS = 1 / 60): void {
    const state = this.manipulation;
    if (!state) return;
    const ray = new THREE.Ray(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    if (!state.resize) {
      const targetRotation = upright(rotation.clone().multiply(state.controllerInverse).multiply(state.rotation));
      const deltaRotation = targetRotation.clone().multiply(state.rotation.clone().invert());
      const offset = state.start.clone().sub(state.position).applyQuaternion(deltaRotation);
      const targetPosition = ray.at(state.distance, new THREE.Vector3()).sub(offset);
      this.panel.position.lerp(targetPosition, 1 - Math.exp(-12 * deltaS));
      this.panel.quaternion.slerp(targetRotation, 1 - Math.exp(-14 * deltaS));
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

/** Keeps yaw and a clamped forward tilt; roll is never allowed. */
function upright(rotation: THREE.Quaternion): THREE.Quaternion {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  const yaw = Math.atan2(forward.x, forward.z);
  const pitch = THREE.MathUtils.clamp(Math.atan2(forward.y, Math.hypot(forward.x, forward.z)), -MAX_PITCH, MAX_PITCH);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, "YXZ"));
}

function attach<T extends xb.TextView>(parent: THREE.Object3D, object: T, x: number, y: number): T {
  object.isRoot = true;
  object.renderOrder = 12;
  parent.add(object);
  object.updateLayouts();
  object.position.set(x / HEIGHT, y / HEIGHT, 0.025 / HEIGHT);
  return object;
}

function label(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string = C.ink, align: Align = "left", weight: "regular" | "semibold" = "regular"): SurfaceText {
  const target = new SurfaceText({ text, font: weight === "semibold" ? UI_FONT_SEMIBOLD : UI_FONT_REGULAR, fontSize: xb.TextView.dpToMeters(fontSize * 1.35) / height, fontColor: color, selectable: false, mode: "center", anchorX: align, textAlign: align });
  target.width = width / HEIGHT;
  target.height = height / HEIGHT;
  return attach(parent, target, x, y);
}

function button(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, action: () => void, variant: ButtonVariant = "default"): SurfaceButton {
  const target = attach(parent, new SurfaceButton({ text, font: UI_FONT_SEMIBOLD, width: width / HEIGHT, height: height / HEIGHT, fontSize: xb.TextView.dpToMeters(26) / height, opacity: 1, backgroundColor: C.control, radius: height / 2, hoverColor: C.ink, selectedFontColor: C.ink }), x, y);
  target.setSurface(variant);
  target.onTriggered = () => {
    if (!target.enabled) return;
    // XR Blocks also intersects hidden descendants, so check the entire ancestry.
    let node: THREE.Object3D | null = target;
    while (node) { if (!node.visible) return; node = node.parent; }
    action();
  };
  return target;
}

function place<T extends THREE.Object3D>(parent: THREE.Object3D, object: T, x: number, y: number, z: number): T {
  object.position.set(x / HEIGHT, y / HEIGHT, z / HEIGHT);
  object.scale.setScalar(1 / HEIGHT);
  parent.add(object);
  return object;
}

function surface(parent: THREE.Object3D, x: number, y: number, width: number, height: number, radius: number, color: string): GlassSurface {
  const mesh = new GlassSurface({ width, height, radius, tint: color, alpha: 1, rim: 0.06, rimWidth: 0.002 });
  mesh.raycast = () => {};
  mesh.renderOrder = 2;
  return place(parent, mesh, x, y, 0.006);
}

function zone(parent: THREE.Object3D, name: string, x: number, y: number, width: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.name = name;
  registerRayTarget(mesh);
  return place(parent, mesh, x, y, 0.004);
}

function rect(parent: THREE.Object3D, x: number, y: number, width: number, height: number, color: string, radius = 0.001, z = 0.008): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(width, height, radius)), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
  mesh.raycast = () => {};
  mesh.renderOrder = 3;
  return place(parent, mesh, x, y, z);
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
