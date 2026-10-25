import * as THREE from "three";
import { WebXRLidarRenderer } from "../../src/sensors/WebXRLidarRenderer";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import type { LidarDisplayMode } from "@dimos-ar-client/sensors/lidarSettings";

export function createLidarReview() {
  document.getElementById("overlay")!.style.display = "none";
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.style.cssText = "position:fixed;inset:0;z-index:10"; document.body.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#182028");
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
  const grid = new THREE.GridHelper(8, 16, 0x3a3a3c, 0x2c2c2e); grid.renderOrder = -200; scene.add(grid);
  const lidar = new WebXRLidarRenderer(); scene.add(lidar.object);
  const origin = { position: [0, 0, 0] as Vec3, orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  const robot: Vec3 = [0, 0, 0.33];
  const room: Vec3[] = Array.from({ length: 4000 }, (_, i) => {
    const height = 0.1 + (i % 40) / 39 * 1.9, horizontal = -2 + (Math.floor(i / 40) % 34) / 33 * 4;
    return i < 1360 ? [2, horizontal, height] : i < 2720 ? [horizontal, 2, height] : [horizontal, -2, height];
  });
  const obstacles: Vec3[] = Array.from({ length: 1200 }, (_, i) => {
    const angle = (i % 60) / 60 * Math.PI * 2, radius = 0.2 + Math.floor(i / 60) / 19 * 1.0;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0.33 + Math.sin(angle * 3) * 0.06];
  });
  function show(mode: LidarDisplayMode) {
    lidar.apply(mode === "obstacles" ? obstacles : room, origin, mode, robot, 0.33);
    camera.position.set(...(mode === "obstacles" ? [1.5, 1.5, 1.7] : [4.4, 3.1, 5.2]) as [number, number, number]);
    camera.lookAt(0, mode === "obstacles" ? 0.2 : 0.8, 0);
    renderer.render(scene, camera);
  }
  show("full"); grid.visible = false; renderer.render(scene, camera);
  const drawCalls = renderer.info.render.calls, pointCount = renderer.info.render.points;
  const start = performance.now();
  for (let i = 0; i < 30; i++) lidar.apply([...room], origin, "full", robot, 0.33);
  const newFrameCpuMs = (performance.now() - start) / 30;
  lidar.apply(room, origin, "full", robot, 0.33);
  const cachedStart = performance.now();
  for (let i = 0; i < 1000; i++) lidar.apply(room, origin, "full", robot, 0.33);
  const cachedFrameCpuMs = (performance.now() - cachedStart) / 1000;
  grid.visible = true;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  return { show, metrics: { drawCalls, pointCount, newFrameCpuMs, cachedFrameCpuMs }, dispose() { renderer.setAnimationLoop(null); lidar.dispose(); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); renderer.dispose(); renderer.domElement.remove(); } };
}
