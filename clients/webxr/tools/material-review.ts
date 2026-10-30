import { ARM_FRESNEL_STYLE as STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { armMaterial } from "../src/manipulation/ArmMaterial";
import { AdaptiveDashedLineRenderer } from "../src/presentation/AdaptiveDashedLineRenderer";
import { linkPoses } from "@dimos-ar-client/manipulation/ModelKinematics";
import { clientTrackingToWebxrPoint, clientTrackingToWebxrPose } from "../src/utilities/WebXRCoordinates";
import type { ManipulationModel } from "@dimos-ar-client/manipulation/ManipulationTypes";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

/** Render the production arm and stroke shaders without hardware or a live robot session. */
export async function renderMaterialReview(kind: "arm" | "strokes", baseline: boolean): Promise<void> {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x24292e);
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(1600, 1000); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.replaceChildren(renderer.domElement);
  document.body.style.cssText = "margin:0;background:#24292e;font-family:Arial,sans-serif;color:#edf4f9;overflow:hidden";
  const heading = document.createElement("div");
  heading.style.cssText = "position:fixed;left:40px;top:26px;font-size:28px;font-weight:600;line-height:1.5";
  heading.innerHTML = `${baseline ? "CURRENT" : "PROPOSED"} · ${kind === "arm" ? "Dotted arm contours" : "Adaptive dotted strokes"}<div style="font-size:17px;font-weight:400;color:#b3c0ca">${kind === "arm" ? baseline ? "Fill 22% · maximum edge 72% · falloff power 1.8" : `Fill ${STYLE.fill * 100}% · maximum edge ${STYLE.edgeOpacity * 100}% · dotted soft contour (power ${STYLE.power})` : baseline ? "Current width and pixel floor at both distances" : "25% thinner nearby · original width restored through the existing distance transition"}</div>`;
  document.body.append(heading);
  const strokes: AdaptiveDashedLineRenderer[] = [];
  if (kind === "arm") {
    const fixture = await fetch("/tests/integration-tests/fixtures/OpenYAM.json").then(r => r.json());
    const model = fixture.model as ManipulationModel;
    const poses = linkPoses(model, fixture.joints);
    const gltf = await new GLTFLoader().loadAsync("/models/openyam.glb");
    const arm = new THREE.Group(); scene.add(arm);
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...clientTrackingToWebxrPoint([1, 0, 0])),
      new THREE.Vector3(...clientTrackingToWebxrPoint([0, 1, 0])), new THREE.Vector3(...clientTrackingToWebxrPoint([0, 0, 1])));
    for (const link of model.links) {
      const node = gltf.scene.getObjectByName(link.name);
      if (!node) continue;
      node.removeFromParent(); node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.setScalar(1);
      node.traverse(part => {
        if (!(part instanceof THREE.Mesh)) return;
        part.geometry = part.geometry.clone();
        if (!part.geometry.getAttribute("normal")) part.geometry.computeVertexNormals();
        part.geometry.applyMatrix4(basis);
        if (link.name === model.root) part.geometry.rotateY(Math.PI / 2);
        const material = armMaterial();
        if (baseline) {
          material.fragmentShader = material.fragmentShader.replace("contourCoverage(-vView, normalize(vNormal), normalize(vView))", "1.0");
          material.uniforms.uFill.value = 0.22; material.uniforms.uRim.value = 0.5; material.uniforms.uPower.value = 1.8;
        }
        part.material = material;
      });
      const pose = clientTrackingToWebxrPose(poses[link.name]);
      node.position.fromArray(pose.position); node.quaternion.fromArray(pose.orientation); arm.add(node);
    }
    const bounds = new THREE.Box3().setFromObject(arm), center = bounds.getCenter(new THREE.Vector3());
    const distance = bounds.getSize(new THREE.Vector3()).length() * 1.32;
    camera.position.copy(center).add(new THREE.Vector3(1.1, 0.45, 1.6).normalize().multiplyScalar(distance));
    camera.lookAt(center);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: 0x383f46, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = bounds.min.y - 0.012; scene.add(floor);
    const grid = new THREE.GridHelper(6, 60, 0x77828c, 0x535e68); grid.position.y = floor.position.y + 0.001; scene.add(grid);
    // A striped wall makes the interior transparency visible with an identical backdrop in each image.
    for (let i = 0; i < 22; i++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.07), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x39434c : 0x2c343c, side: THREE.DoubleSide }));
      strip.position.set(0, i * 0.075 - 0.1, bounds.min.z - 0.35); scene.add(strip);
    }
  } else {
    camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1);
    const rows = [
      { label: "Selected bounds / confirmed route", width: 0.00275, opacity: 0.8 },
      { label: "Preview route", width: 0.00275, opacity: 0.6 },
      { label: "Hover bounds", width: 0.0008, opacity: 0.45 },
      { label: "Connector / floor outline", width: 0.00275, opacity: 0.5 },
    ];
    for (const [column, distance] of [0.75, 6].entries()) {
      const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const halfWidth = halfHeight * camera.aspect;
      const centerX = (column ? 0.47 : -0.47) * halfWidth;
      for (const [index, row] of rows.entries()) {
        const y = (0.38 - index * 0.34) * halfHeight;
        const stroke = new AdaptiveDashedLineRenderer(row.width); stroke.setStyle(row.width, row.opacity);
        stroke.object.material.uniforms.uNearWidthScale.value = baseline ? 1 : 0.75;
        stroke.setSegments([[centerX - halfWidth * 0.3, y, -distance], [centerX + halfWidth * 0.08, y, -distance]], true);
        strokes.push(stroke); scene.add(stroke.object);
        const circle = new AdaptiveDashedLineRenderer(row.width); circle.setStyle(row.width, row.opacity);
        circle.object.material.uniforms.uNearWidthScale.value = baseline ? 1 : 0.75;
        const radius = halfHeight * 0.095, points: Vec3[] = [];
        for (let i = 0; i < 128; i++) for (const t of [i / 128, (i + 1) / 128])
          points.push([centerX + halfWidth * 0.25 + Math.cos(t * Math.PI * 2) * radius, y + Math.sin(t * Math.PI * 2) * radius, -distance]);
        circle.setSegments(points, true); strokes.push(circle); scene.add(circle.object);
        if (!column) {
          const label = document.createElement("div"); label.textContent = row.label;
          label.style.cssText = `position:fixed;left:45px;top:${(1 - (0.38 - index * 0.34)) * 500 - 48}px;font-size:17px;color:#b5c1cb`;
          document.body.append(label);
        }
      }
      const label = document.createElement("div");
      label.style.cssText = `position:fixed;left:${column ? 1050 : 330}px;top:175px;font-size:24px`;
      label.textContent = column ? "FAR · 6 m" : "NEAR · 0.75 m"; document.body.append(label);
    }
  }
  renderer.render(scene, camera);
  await new Promise<void>(resolve => requestAnimationFrame(() => { renderer.render(scene, camera); resolve(); }));
}
