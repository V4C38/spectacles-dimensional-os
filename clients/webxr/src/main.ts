import * as THREE from "three";
import * as xb from "xrblocks";
import { HMD_OPTIONS, parseHmdId, requireAcceptedProfile } from "./camera/HmdCalibration";
import { profileForHmd } from "./camera/hmdProfiles";
import {
  browserMediaPort,
  canvasJpegEncoder,
  HmdCameraSource,
  videoFrameCallbackPort,
} from "./camera/HmdCameraSource";
import { DimOSWebXRClient } from "./DimOSWebXRClient";
import {
  isMenuButtonPressed,
  isTriggerPressed,
  type JoystickAxes,
} from "./navigation/WebXRJoystick";
import { planeNormalFromPose, type FloorPlane } from "./navigation/WebXRGroundPlacement";
import { rayHitsObject } from "./navigation/WebXRNavGoalView";
import { toneCss } from "./presentation/tones";
import { MainMenuView } from "./presentation/MainMenuView";
import { arModuleSameOriginUrl } from "./runtimeConfig";
import { BrowserClientClock } from "./time/BrowserClientClock";
import { BrowserWebSocketTransport } from "./websocket/BrowserWebSocketTransport";
import type { StatusTone } from "@dimos-ar-client/websocket/sessionLinkStatus";

class DimOSWebXRApp extends xb.Script {
  private client: DimOSWebXRClient | null = null;
  private mainMenu: MainMenuView | null = null;
  private wristButton: THREE.Mesh | null = null;
  private worldHold = false;
  private uiGrab = false;
  private menuWasPressed = false;

  constructor(client: DimOSWebXRClient) {
    super();
    this.client = client;
  }

  override init(): void {
    const client = this.requireClient();
    this.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    this.add(client.robot.object);
    this.add(client.lidar.object);
    this.add(client.route.object);
    this.add(client.markers.object);
    this.add(client.navigation.marker.object);
    this.mainMenu = new MainMenuView({
      onSetup: () => this.client?.ui.completeSetup(),
      onRestart: () => this.client?.restartSetup(),
      onMenu: () => this.client?.ui.toggleMenu(),
      onMode: () => {
        const ui = this.client?.ui;
        if (!ui) {
          return;
        }
        const snap = ui.snapshot();
        if (!snap.agentAvailable) {
          return;
        }
        ui.setOperatingMode(ui.operatingMode === "manual" ? "agent" : "manual");
      },
      onLidar: () => this.client?.ui.cycleLidar(),
      onLocalize: () => this.client?.ui.restartLocalization(),
      onEstop: () => this.client?.ui.estop(),
    });
    this.add(this.mainMenu.panel);
    this.wristButton = this.createWristButton();
    this.add(this.wristButton);
    client.start();
  }

  override update(): void {
    const client = this.client;
    if (!client) {
      return;
    }
    const camera = xb.core.camera;
    client.tick(
      {
        position: [camera.position.x, camera.position.y, camera.position.z],
        orientation: [
          camera.quaternion.x,
          camera.quaternion.y,
          camera.quaternion.z,
          camera.quaternion.w,
        ],
      },
      readJoystick(),
    );
    this.syncWristButton();
    this.mainMenu?.apply(client.ui.snapshot());
    const menu = menuPressed();
    if (menu && !this.menuWasPressed) {
      client.ui.toggleMenu();
    }
    this.menuWasPressed = menu;
    const ray = pointingRay();
    if (!ray || this.uiGrab) {
      return;
    }
    const holding = this.worldHold || triggerPressed();
    if (holding && client.ui.setupCompleted) {
      client.holdNavigation(ray.origin, ray.direction, floorPlanes());
    }
  }

  override onSelectStart(): void {
    const client = this.client;
    const ray = pointingRay();
    if (!client || !ray) {
      return;
    }
    if (this.wristButton && rayHitsObject(ray.origin, ray.direction, this.wristButton)) {
      client.ui.toggleMenu();
      this.uiGrab = true;
      return;
    }
    if (this.mainMenu && rayHitsObject(ray.origin, ray.direction, this.mainMenu.panel)) {
      this.uiGrab = true;
      return;
    }
    if (client.navigation.marker.hitCancel(ray.origin, ray.direction)) {
      client.cancelNavigation();
      this.uiGrab = true;
      return;
    }
    if (!client.ui.setupCompleted || !client.session.view().hasTrackingOrigin) {
      return;
    }
    this.worldHold = true;
    client.holdNavigation(ray.origin, ray.direction, floorPlanes());
  }

  override onSelectEnd(): void {
    const client = this.client;
    const ray = pointingRay();
    if (this.worldHold && client && ray) {
      client.releaseNavigation(ray.origin, ray.direction, floorPlanes());
    }
    this.worldHold = false;
    this.uiGrab = false;
  }

  override dispose(): void {
    this.client?.dispose();
    this.client = null;
    super.dispose();
  }

  private requireClient(): DimOSWebXRClient {
    if (!this.client) {
      throw new Error("DimOSWebXRClient is required");
    }
    return this.client;
  }

  private createWristButton(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.01, 24),
      new THREE.MeshStandardMaterial({ color: 0x4c8bf5 }),
    );
    mesh.name = "leftWristMenuButton";
    return mesh;
  }

  private syncWristButton(): void {
    if (!this.wristButton) {
      return;
    }
    const left = xb.input.hands?.left;
    const wrist = left?.joints?.wrist ?? left?.wrist;
    if (!wrist) {
      this.wristButton.visible = Boolean(this.client?.ui.menuOpen);
      return;
    }
    this.wristButton.visible = true;
    this.wristButton.position.copy(wrist.position);
    this.wristButton.quaternion.copy(wrist.quaternion);
  }
}

function readJoystick(): JoystickAxes | null {
  const sources = xb.core.input?.inputSources ?? [];
  for (const source of sources) {
    if (source.handedness !== "left" || !source.gamepad) {
      continue;
    }
    const axes = source.gamepad.axes;
    if (axes.length >= 4) {
      return { x: axes[2], y: axes[3] };
    }
    if (axes.length >= 2) {
      return { x: axes[0], y: axes[1] };
    }
    return null;
  }
  return null;
}

function menuPressed(): boolean {
  const sources = xb.core.input?.inputSources ?? [];
  for (const source of sources) {
    if (source.gamepad && isMenuButtonPressed(source.gamepad.buttons)) {
      return true;
    }
  }
  return false;
}

function triggerPressed(): boolean {
  const sources = xb.core.input?.inputSources ?? [];
  for (const source of sources) {
    if (source.gamepad && isTriggerPressed(source.gamepad.buttons)) {
      return true;
    }
  }
  return false;
}

function pointingRay(): { origin: [number, number, number]; direction: [number, number, number] } | null {
  const controller = xb.core.input?.controllers?.[0] ?? xb.core.controller;
  if (controller) {
    const origin = controller.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      controller.getWorldQuaternion(new THREE.Quaternion()),
    );
    return {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    };
  }
  const camera = xb.core.camera;
  if (!camera) {
    return null;
  }
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return {
    origin: [camera.position.x, camera.position.y, camera.position.z],
    direction: [direction.x, direction.y, direction.z],
  };
}

function floorPlanes(): FloorPlane[] {
  const planes = xb.world?.planes;
  const floors = planes?.get?.("floor") ?? [];
  const hits: FloorPlane[] = [];
  for (const plane of floors) {
    const position = plane.position ?? plane.getWorldPosition?.(new THREE.Vector3());
    const quaternion = plane.quaternion ?? plane.getWorldQuaternion?.(new THREE.Quaternion());
    if (!position || !quaternion) {
      continue;
    }
    hits.push({
      position: [position.x, position.y, position.z],
      normal: planeNormalFromPose([quaternion.x, quaternion.y, quaternion.z, quaternion.w]),
    });
  }
  return hits;
}

function setStatus(text: string, tone: StatusTone = "neutral"): void {
  const node = document.getElementById("status");
  if (node) {
    node.textContent = text;
    node.style.color = toneCss(tone);
  }
}

class LandingError extends Error {
  readonly tone: StatusTone;

  constructor(message: string, tone: StatusTone) {
    super(message);
    this.tone = tone;
  }
}

function setStatusFromUnknown(error: unknown): void {
  if (error instanceof LandingError) {
    setStatus(error.message, error.tone);
    return;
  }
  setStatus(error instanceof Error ? error.message : String(error), "error");
}

function populateHmdSelect(select: HTMLSelectElement): void {
  for (const option of HMD_OPTIONS) {
    const node = document.createElement("option");
    node.value = option.id;
    node.textContent = option.label;
    if (option.id === "quest3") {
      node.selected = true;
    }
    select.append(node);
  }
  select.value = "quest3";
}

async function requireImmersiveAr(): Promise<void> {
  const xr = (navigator as Navigator & { xr?: { isSessionSupported?(mode: string): Promise<boolean> } }).xr;
  if (!xr?.isSessionSupported || !(await xr.isSessionSupported("immersive-ar"))) {
    throw new LandingError("WebXR cannot start from a desktop browser.", "warn");
  }
}

async function boot(): Promise<void> {
  const enter = document.getElementById("enter") as HTMLButtonElement | null;
  const select = document.getElementById("hmd") as HTMLSelectElement | null;
  const overlay = document.getElementById("overlay");
  if (select) {
    populateHmdSelect(select);
  }
  try {
    const url = arModuleSameOriginUrl(window.location);
    setStatus("Enter AR on the headset.", "muted");
    if (select) {
      select.disabled = false;
    }
    if (enter && select) {
      enter.disabled = false;
      enter.onclick = () => {
        void (async () => {
          try {
            enter.disabled = true;
            const profile = profileForHmd(parseHmdId(select.value));
            await requireImmersiveAr();
            requireAcceptedProfile(profile);
            const camera = new HmdCameraSource({
              clock: new BrowserClientClock(),
              profile,
              media: browserMediaPort(),
              frames: videoFrameCallbackPort(),
              jpeg: canvasJpegEncoder(),
            });
            await camera.prepare();
            const client = new DimOSWebXRClient({
              transport: new BrowserWebSocketTransport({ url }),
              clock: new BrowserClientClock(),
              camera,
            });
            overlay?.remove();
            const options = new xb.Options();
            options.enableHands();
            options.enableUI();
            options.enablePlaneDetection();
            options.controllers.enabled = true;
            xb.add(new DimOSWebXRApp(client));
            xb.init(options);
          } catch (error) {
            setStatusFromUnknown(error);
            enter.disabled = false;
          }
        })();
      };
    }
  } catch (error) {
    setStatusFromUnknown(error);
    if (enter) {
      enter.disabled = true;
    }
  }
}

void boot();
