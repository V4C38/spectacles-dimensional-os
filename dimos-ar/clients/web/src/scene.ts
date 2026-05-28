import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LidarMessage, PoseMessage } from "./protocol";

const MAX_POINTS = 4000;

export class LidarScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pointsMesh: THREE.Points;
  private positionAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private robotGroup: THREE.Group;
  private robotBox: THREE.Mesh;
  private animationId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a0f);

    this.scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(10, 20, 0x333344, 0x222233);
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(0.5);
    this.scene.add(axes);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    this.camera.position.set(3, 2.5, 3);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;

    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute("position", this.positionAttr);
    geometry.setAttribute("color", this.colorAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.pointsMesh = new THREE.Points(geometry, material);
    this.scene.add(this.pointsMesh);

    const boxGeo = new THREE.BoxGeometry(0.5, 0.25, 0.35);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x00ff7f });
    this.robotBox = new THREE.Mesh(boxGeo, boxMat);
    this.robotGroup = new THREE.Group();
    this.robotGroup.add(this.robotBox);
    const robotAxes = new THREE.AxesHelper(0.4);
    this.robotGroup.add(robotAxes);
    this.scene.add(this.robotGroup);

    this.onResize();
    window.addEventListener("resize", () => this.onResize());
    this.startLoop();
  }

  private onResize(): void {
    const parent = this.renderer.domElement.parentElement;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private startLoop(): void {
    const tick = () => {
      this.animationId = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    window.removeEventListener("resize", () => this.onResize());
    this.renderer.dispose();
  }

  updateLidar(msg: LidarMessage): void {
    const n = Math.min(msg.points.length, MAX_POINTS);
    const pos = this.positionAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;

    for (let i = 0; i < n; i++) {
      const p = msg.points[i]!;
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = p[2];

      if (msg.colors !== undefined && msg.colors[i] !== undefined) {
        const c = msg.colors[i]!;
        col[i * 3] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
      } else {
        const dist = Math.hypot(p[0], p[1]);
        const t = Math.min(dist / 3, 1);
        col[i * 3] = t * 0.2;
        col[i * 3 + 1] = 1 - 0.5 * t;
        col[i * 3 + 2] = 1;
      }
    }

    this.pointsMesh.geometry.setDrawRange(0, n);
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  updatePose(msg: PoseMessage): void {
    const [x, y, z] = msg.position;
    const [qx, qy, qz, qw] = msg.orientation;
    this.robotGroup.position.set(x, y, z);
    this.robotGroup.quaternion.set(qx, qy, qz, qw);
  }
}
