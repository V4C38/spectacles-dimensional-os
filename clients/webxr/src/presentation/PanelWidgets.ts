import * as THREE from "three";
import * as xb from "xrblocks";
import { CONTROL_PANEL_SECTION, controlPanelTab } from "@dimos-ar-client/presentation/ControlPanelPresentation";
import { DIMOS_AR_DESIGN, cornerRadius } from "./DimOSARDesign";
import { SurfaceText, ScrollableTextView } from "./TextViews";
import { SurfaceButton, type ButtonVariant } from "./SurfaceButton";

import { GlassSurface } from "./SurfaceMaterials";
import { UI_FONT_REGULAR, UI_FONT_SEMIBOLD } from "./SceneResources";
const C = DIMOS_AR_DESIGN.colors;
const HEIGHT = DIMOS_AR_DESIGN.panel.height;
const CONTENT = DIMOS_AR_DESIGN.panel.width - DIMOS_AR_DESIGN.panel.margin * 2;
const LEFT = -CONTENT / 2;
const CLOSE_X = CONTENT / 2 - DIMOS_AR_DESIGN.controls.iconSize / 2;
const HEADER_Y = 0.286;
const ACTION_HEIGHT = DIMOS_AR_DESIGN.controls.height;
const ICON_SIZE = DIMOS_AR_DESIGN.controls.iconSize;
type Align = "left" | "center" | "right";

function attach<T extends xb.TextView>(parent: THREE.Object3D, object: T, x: number, y: number): T {
  object.isRoot = true;
  object.renderOrder = 12;
  parent.add(object);
  object.updateLayouts();
  object.position.set(x / HEIGHT, y / HEIGHT, DIMOS_AR_DESIGN.depth.text / HEIGHT);
  return object;
}

export function label(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string = C.ink, align: Align = "left", weight: "regular" | "semibold" = "regular"): SurfaceText {
  if (align === "left" && width >= CONTENT - 0.01) width -= 0.02;
  const target = new SurfaceText({ text, font: weight === "semibold" ? UI_FONT_SEMIBOLD : UI_FONT_REGULAR, fontSize: xb.TextView.dpToMeters(fontSize * 1.35) / height, fontColor: color, selectable: false, mode: "center", anchorX: align, textAlign: align });
  target.width = width / HEIGHT;
  target.height = height / HEIGHT;
  target.userData.depthM = weight === "semibold" && fontSize >= 28 ? DIMOS_AR_DESIGN.depth.primary : DIMOS_AR_DESIGN.depth.secondary + 0.001;
  return attach(parent, target, x, y);
}

export function button(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, action: () => void, variant: ButtonVariant = "default"): SurfaceButton {
  const target = attach(parent, new SurfaceButton({ text, font: UI_FONT_SEMIBOLD, width: width / HEIGHT, height: height / HEIGHT, fontSize: xb.TextView.dpToMeters(26) / height, opacity: 1, backgroundColor: C.control, radius: height / 2, hoverColor: C.ink, selectedFontColor: C.ink }), x, y);
  target.position.z = DIMOS_AR_DESIGN.depth.surface / HEIGHT;
  target.setSurface(variant);
  target.onTriggered = () => {
    if (!target.enabled) return;
    // XR Blocks also intersects hidden descendants, so check the entire ancestry.
    let node: THREE.Object3D | null = target;
    while (node) { if (!node.visible || node.userData.rayDisabled === true) return; node = node.parent; }
    action();
  };
  return target;
}

export function place<T extends THREE.Object3D>(parent: THREE.Object3D, object: T, x: number, y: number, z: number): T {
  object.position.set(x / HEIGHT, y / HEIGHT, z / HEIGHT);
  object.scale.setScalar(1 / HEIGHT);
  parent.add(object);
  return object;
}

export function surface(parent: THREE.Object3D, x: number, y: number, width: number, height: number, radius: number, color: string): GlassSurface {
  const mesh = new GlassSurface({ width, height, radius: radius || cornerRadius(width, height), tint: color, alpha: 1, rim: 0.06, rimWidth: 0.002 });
  mesh.raycast = () => {};
  mesh.material.depthWrite = false;
  mesh.renderOrder = 2;
  return place(parent, mesh, x, y, DIMOS_AR_DESIGN.depth.surface);
}

export function rect(parent: THREE.Object3D, x: number, y: number, width: number, height: number, color: string, radius = 0.001, z = 0.008): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
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

export function setText(target: xb.TextView, value: string): void {
  if (target.text !== value) target.setText(value);
}
export function clip(text: string, max: number): string { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }

export function cameraIcon(parent: THREE.Object3D, x: number, y: number, surface: SurfaceButton): void {
  const icon = new THREE.Group();
  icon.name = "Capabilities robot icon";
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
  const body = new THREE.Shape();
  body.moveTo(-0.018, -0.012); body.lineTo(0.018, -0.012);
  body.quadraticCurveTo(0.021, -0.012, 0.021, -0.009); body.lineTo(0.021, 0.009);
  body.quadraticCurveTo(0.021, 0.012, 0.018, 0.012); body.lineTo(0.008, 0.012);
  body.lineTo(0.004, 0.018); body.lineTo(-0.009, 0.018); body.lineTo(-0.013, 0.012);
  body.lineTo(-0.018, 0.012); body.quadraticCurveTo(-0.021, 0.012, -0.021, 0.009);
  body.lineTo(-0.021, -0.009); body.quadraticCurveTo(-0.021, -0.012, -0.018, -0.012);
  const opening = new THREE.Path();
  opening.moveTo(-0.017, -0.008); opening.lineTo(-0.017, 0.008);
  opening.lineTo(0.017, 0.008); opening.lineTo(0.017, -0.008); opening.closePath();
  body.holes.push(opening);
  icon.add(new THREE.Mesh(new THREE.ShapeGeometry(body), material));
  for (const eye of [-1,1]) { const mesh = new THREE.Mesh(new THREE.CircleGeometry(.003,12), material); mesh.position.set(eye*.008,0,0); icon.add(mesh); }
  const antenna = new THREE.Mesh(new THREE.PlaneGeometry(.003,.01), material); antenna.position.y=.02; icon.add(antenna);
  icon.traverse(child => { child.raycast = () => {}; child.renderOrder = 13; });
  icon.userData.followSurface = surface;
  place(parent, icon, x, y, DIMOS_AR_DESIGN.depth.text);
}

export function gearIcon(parent: THREE.Object3D, x: number, y: number, surface: SurfaceButton): void {
  const icon = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
  icon.add(new THREE.Mesh(new THREE.RingGeometry(0.007, 0.013, 32), material));
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const tooth = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.006), material);
    tooth.position.set(Math.sin(angle) * 0.014, Math.cos(angle) * 0.014, 0);
    tooth.rotation.z = -angle;
    icon.add(tooth);
  }
  icon.traverse(child => { child.raycast = () => {}; child.renderOrder = 13; });
  icon.userData.followSurface = surface;
  place(parent, icon, x, y, DIMOS_AR_DESIGN.depth.text);
}

export function layoutText(text: SurfaceText | ScrollableTextView, x: number, y: number, width: number, height: number, size: number): void {
  text.width = width / HEIGHT; text.height = height / HEIGHT;
  text.fontSize = xb.TextView.dpToMeters(size * 1.35) / height;
  text.updateLayouts(); text.position.x = x / HEIGHT; text.position.y = y / HEIGHT;
}

export function iconClose(parent: THREE.Object3D, name: string, action: () => void): SurfaceButton {
  const target = button(parent, "", CLOSE_X, HEADER_Y, ICON_SIZE, ICON_SIZE, action);
  target.name = name;
  const icon = new THREE.Group();
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.0035), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
    bar.rotation.z = angle; bar.raycast = () => {}; bar.renderOrder = 13; icon.add(bar);
  }
  icon.userData.followSurface = target;
  icon.renderOrder = 13; place(parent, icon, CLOSE_X, HEADER_Y, DIMOS_AR_DESIGN.depth.text);
  return target;
}

export function scrollLabel(parent: THREE.Object3D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string = C.ink, bodyScrollable = true): ScrollableTextView {
  const target = new ScrollableTextView({ text, font: UI_FONT_REGULAR, fontSize: xb.TextView.dpToMeters(fontSize * 1.35) / height, fontColor: color, selectable: false, mode: "center", anchorX: "left", textAlign: "left" }, bodyScrollable);
  target.width = width / HEIGHT; target.height = height / HEIGHT;
  return attach(parent, target, x, y);
}

/** Both conversation fields use this exact primitive; only the input behavior differs. */
export function messageField(parent: THREE.Object3D, caption: string, y: number, bodyScrollable: boolean): { surface: SurfaceButton; content: ScrollableTextView } {
  const block = new THREE.Group();
  block.position.y = y / HEIGHT; parent.add(block);
  const height = DIMOS_AR_DESIGN.message.height;
  const field = button(block, "", 0, 0, CONTENT, height, () => {}, "field");
  if (bodyScrollable) field.mesh!.userData.interactionEnabled = false;
  const heading = label(block, caption, LEFT + DIMOS_AR_DESIGN.message.padding + 0.2, DIMOS_AR_DESIGN.message.captionY, 0.4, DIMOS_AR_DESIGN.message.captionHeight, 15, C.muted, "left", "semibold");
  heading.userData.followSurface = field;
  heading.position.z = DIMOS_AR_DESIGN.depth.text / HEIGHT; heading.renderOrder = 14;
  const content = scrollLabel(block, "", 0, DIMOS_AR_DESIGN.message.textY, CONTENT - DIMOS_AR_DESIGN.message.padding * 2, DIMOS_AR_DESIGN.message.textHeight, 20, C.ink, bodyScrollable);
  content.userData.followSurface = field;
  content.position.z = DIMOS_AR_DESIGN.depth.text / HEIGHT; content.renderOrder = 14;
  return { surface: field, content };
}

export function tabs<T extends readonly string[]>(parent: THREE.Object3D, labels: T, y: number, actions: readonly (() => void)[]): { [K in keyof T]: SurfaceButton } {
  const rail = surface(parent, 0, y, CONTENT, ACTION_HEIGHT + 0.012, (ACTION_HEIGHT + 0.012) / 2, C.field);
  rail.name = "Segmented control track";
  rail.userData.panelRow = "tabs";
  rail.position.z = 0.002 / HEIGHT;
  return labels.map((text, i) => {
    const { x, width } = controlPanelTab(labels.length, i);
    const target = button(parent, text, x, y, width, ACTION_HEIGHT, actions[i], "tab");
    target.userData.supportSurface = rail;
    target.userData.panelRow = "tabs";
    return target;
  }) as { [K in keyof T]: SurfaceButton };
}

export function sectionHeading(parent: THREE.Object3D, text: string, y: number): SurfaceText {
  const style = CONTROL_PANEL_SECTION;
  const heading = label(parent, text, style.left + (style.width - 0.02) / 2, y, style.width, style.height, style.fontDp, style.color, "left");
  heading.userData.depthM = style.depthM;
  heading.userData.sectionHeading = true;
  return heading;
}
