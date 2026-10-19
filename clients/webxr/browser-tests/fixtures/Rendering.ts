import * as THREE from "three";
import { WebXRLidarRenderer, WebXRRouteRenderer } from "../../src/presentation/WebXRPresenters";
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
  function pixelAt(point: THREE.Vector3): number[] {
    const clip = point.project(camera);
    const pixel = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, Math.round((clip.x + 1) * 256), Math.round((clip.y + 1) * 256), 1, 1, pixel);
    return [...pixel];
  }
  const short: YawPose[] = [[0, -1, 0, 0], [0.1, -1, 0, 0]];
  const long: YawPose[] = [...short, [0.5, -1, 0, 0], [1, -1, 0, 0]];
  route.apply(short, origin, true, 0, 0);
  renderer.render(scene, camera); // Populate the real GPU's instance-count cache.
  route.apply(long, origin, true, 0, 0);
  renderer.render(scene, camera);
  const longEnd = pixelAt(new THREE.Vector3(1, 0, -0.9));
  route.apply(short, origin, true, 0, 0);
  renderer.render(scene, camera);
  const shortEnd = pixelAt(new THREE.Vector3(1, 0, -0.9));
  route.apply(long, origin, true, 0, 0);
  renderer.render(scene, camera);
  const regrownEnd = pixelAt(new THREE.Vector3(1, 0, -0.9));
  route.hide();

  const lidar = new WebXRLidarRenderer();
  lidar.object.material.size = 32;
  lidar.apply([[0, 0, 1]], origin); // Point is closer to the camera than the panel.
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
  panel.geometry.dispose(); panel.material.dispose();
  route.dispose(); lidar.dispose(); target.dispose(); renderer.dispose();
  return { longEnd, shortEnd, regrownEnd, opaqueUi, transparentUi, lidarOnly };
}
