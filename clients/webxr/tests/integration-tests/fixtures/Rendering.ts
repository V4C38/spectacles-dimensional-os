import * as THREE from "three";
import { WebXRLidarRenderer } from "../../../src/sensors/WebXRLidarRenderer";
import { WebXRRouteRenderer } from "../../../src/navigation/WebXRRouteRenderer";
import type { YawPose } from "@dimos-ar-client/websocket/protocolTypes";

export function verifyRendering() {
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(512, 512);
  renderer.setClearColor(0x000000);
  const target = new THREE.WebGLRenderTarget(512, 512);
  renderer.setRenderTarget(target);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  camera.position.set(0, 5, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  const route = new WebXRRouteRenderer();
  scene.add(route.object);
  function pixelAt(point: THREE.Vector3, radius = 0): number[] {
    const clip = point.project(camera);
    let brightest = [0, 0, 0, 255];
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const pixel = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, Math.round((clip.x + 1) * 256) + x, Math.round((clip.y + 1) * 256) + y, 1, 1, pixel);
      if (pixel[0] + pixel[1] + pixel[2] >= brightest[0] + brightest[1] + brightest[2]) brightest = [...pixel];
    }
    return brightest;
  }
  const short: YawPose[] = [[0, -1, 0, 0], [0.1, -1, 0, 0]];
  const long: YawPose[] = [...short, [0.5, -1, 0, 0], [1, -1, 0, 0]];
  route.apply(short, origin, true, 0, 0);
  renderer.render(scene, camera); // Populate the real GPU's instance-count cache.
  route.apply(long, origin, true, 0, 0);
  renderer.render(scene, camera);
  const longEnd = pixelAt(new THREE.Vector3(1, 0, -0.9), 2);
  route.apply(short, origin, true, 0, 0);
  renderer.render(scene, camera);
  const shortEnd = pixelAt(new THREE.Vector3(1, 0, -0.9), 2);
  route.apply(long, origin, true, 0, 0);
  renderer.render(scene, camera);
  const regrownEnd = pixelAt(new THREE.Vector3(1, 0, -0.9), 2);
  const dense: YawPose[] = Array.from({ length: 21 }, (_, i) => [0, i / 20, 0, 0]);
  route.apply(dense, origin, true, 0, 0, { executing: true });
  renderer.render(scene, camera);
  const routeMiddle = pixelAt(new THREE.Vector3(-0.475, 0, 0), 1);
  const routeJoin = pixelAt(new THREE.Vector3(-0.5, 0, 0), 1);
  route.hide();

  const lidar = new WebXRLidarRenderer();
  lidar.object.material.size = 32;
  lidar.apply([[0, 0, 1]], origin, "full"); // Point is closer to the camera than the panel.
  scene.add(lidar.object);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }));
  panel.rotation.x = -Math.PI / 2;
  scene.add(panel);
  renderer.render(scene, camera);
  const opaqueUi = pixelAt(new THREE.Vector3(0, 0, 0));
  panel.material.transparent = true;
  renderer.render(scene, camera);
  const transparentUi = pixelAt(new THREE.Vector3(0, 0, 0));
  panel.visible = false;
  renderer.render(scene, camera);
  const lidarOnly = pixelAt(new THREE.Vector3(0, 0, 0));
  lidar.apply([[0.4, 0, 0.4], [0.65, 0, 0.4], [0.95, 0, 0.4]], origin, "obstacles", [0, 0, 0.33]);
  renderer.render(scene, camera);
  const obstacleNear = pixelAt(new THREE.Vector3(0, 0.4, -0.4), 1);
  const obstacleMid = pixelAt(new THREE.Vector3(0, 0.4, -0.65), 1);
  const obstacleEdge = pixelAt(new THREE.Vector3(0, 0.4, -0.95), 1);
  panel.geometry.dispose(); panel.material.dispose();
  route.dispose(); lidar.dispose(); target.dispose(); renderer.dispose();
  return { longEnd, shortEnd, regrownEnd, opaqueUi, transparentUi, lidarOnly, routeMiddle, routeJoin, obstacleNear, obstacleMid, obstacleEdge };
}
