import { BridgeClient } from "./websocket";
import { LidarScene } from "./scene";
import {
  clearActiveRobotId,
  formatBridgeStatus,
  type OutboundMessage,
} from "./protocol";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const wsUrlInput = document.getElementById("ws-url") as HTMLInputElement;
const btnConnect = document.getElementById("btn-connect") as HTMLButtonElement;
const btnDisconnect = document.getElementById("btn-disconnect") as HTMLButtonElement;
const btnRegister = document.getElementById("btn-register") as HTMLButtonElement;
const statConnection = document.getElementById("stat-connection")!;
const statCapabilities = document.getElementById("stat-capabilities")!;
const statBridge = document.getElementById("stat-bridge")!;
const statRegistered = document.getElementById("stat-registered")!;
const statLidarPoints = document.getElementById("stat-lidar-points")!;
const statLidarHz = document.getElementById("stat-lidar-hz")!;
const statPoseHz = document.getElementById("stat-pose-hz")!;
const errorEl = document.getElementById("error") as HTMLParagraphElement;

const scene = new LidarScene(canvas);
let client: BridgeClient | null = null;

let lidarCount = 0;
let poseCount = 0;
let lidarHz = 0;
let poseHz = 0;
let lastRateTick = performance.now();

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError(): void {
  errorEl.hidden = true;
}

function setUiConnected(connected: boolean): void {
  btnConnect.disabled = connected;
  btnDisconnect.disabled = !connected;
  btnRegister.disabled = !connected;
  wsUrlInput.disabled = connected;
  statConnection.textContent = connected ? "connected" : "disconnected";
}

function onMessage(msg: OutboundMessage): void {
  switch (msg.type) {
    case "hello":
      statCapabilities.textContent = msg.capabilities.join(", ");
      break;
    case "lidar":
      lidarCount++;
      scene.updateLidar(msg);
      statLidarPoints.textContent = String(msg.points.length);
      break;
    case "pose":
      poseCount++;
      scene.updatePose(msg);
      break;
    case "registered":
      statRegistered.textContent = msg.registered ? "yes" : "no";
      break;
    case "bridge_status":
      statBridge.textContent = formatBridgeStatus(msg);
      statRegistered.textContent = msg.registered ? "yes" : "no";
      break;
  }
}

function updateRates(): void {
  const now = performance.now();
  const dt = (now - lastRateTick) / 1000;
  if (dt >= 1) {
    lidarHz = lidarCount / dt;
    poseHz = poseCount / dt;
    lidarCount = 0;
    poseCount = 0;
    lastRateTick = now;
    statLidarHz.textContent = `${lidarHz.toFixed(1)} Hz`;
    statPoseHz.textContent = `${poseHz.toFixed(1)} Hz`;
  }
  requestAnimationFrame(updateRates);
}

updateRates();

btnConnect.addEventListener("click", () => {
  clearError();
  const url = wsUrlInput.value.trim();
  if (!url) {
    showError("WebSocket URL is required");
    return;
  }
  client = new BridgeClient(url, {
    onOpen: () => {
      setUiConnected(true);
      statRegistered.textContent = "—";
      statCapabilities.textContent = "—";
      statBridge.textContent = "—";
    },
    onClose: () => {
      setUiConnected(false);
      clearActiveRobotId();
      client = null;
    },
    onError: (message) => {
      showError(message);
    },
    onMessage,
  });
  client.connect();
});

btnDisconnect.addEventListener("click", () => {
  client?.disconnect();
  setUiConnected(false);
  clearActiveRobotId();
  client = null;
});

btnRegister.addEventListener("click", () => {
  clearError();
  try {
    client?.sendDevRegister();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});
