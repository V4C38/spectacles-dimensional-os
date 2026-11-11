import {ARM_PANEL_STYLE, PANEL_PIN_SEGMENTS, PANEL_SCAN_SEGMENTS} from "@dimos-ar-client/presentation/PanelFrameStyle";
import * as THREE from "three";
import {registerRayTarget, UI_CONTROL_RAY_PRIORITY} from "../input/XRBlocksRayInteraction";
import {disposeObjectTrees} from "../manipulation/ObjectResources";

/** The same bottom move bar and corner scaling affordances as the runtime window. */
export class RobotPanelFrame {
  readonly object=new THREE.Group();
  readonly pinLines: THREE.Mesh;
  readonly scanLines: THREE.Mesh;
  private readonly bar: THREE.Mesh;
  private readonly zones: THREE.Mesh[]=[];
  private readonly corners: THREE.Mesh[]=[];
  constructor(parent: THREE.Object3D) {
    parent.add(this.object);
    const chrome = panelChrome(this.object, ARM_PANEL_STYLE.cornerM, .5);
    this.bar = chrome.bar; this.zones.push(chrome.barZone, chrome.cornerZones.left, chrome.cornerZones.right);
    this.corners.push(chrome.cornerArcs.left, chrome.cornerArcs.right);
    for (const [i,mesh] of this.zones.entries()) { mesh.userData.manipulationPanel=true; mesh.userData.panelHandle=["bar","left","right"][i]; }
    this.pinLines = panelIcon(PANEL_PIN_SEGMENTS);
    this.pinLines.name = "ArmPanelPinIcon";
    this.scanLines = panelIcon(PANEL_SCAN_SEGMENTS);
    this.scanLines.name = "ArmPanelScanIcon";
  }
  resize(height:number):void {
    this.bar.position.set(0,-height-.018,.006);
    this.zones[0].position.copy(this.bar.position);
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      this.zones[i+1].position.set(side*.112,-height,.006);
      this.corners[i].position.set(side*(.112-ARM_PANEL_STYLE.cornerM),-height+ARM_PANEL_STYLE.cornerM,.006);
    }
  }
  updateHover(hits: (THREE.Object3D | undefined)[], dt: number): void {
    const looking = hits.some(hit => !!hit && (hit.userData.manipulationPanel || hit.userData.manipulationAction));
    const k = 1-Math.exp(-14*dt);
    for(let i=0;i<2;i++) { const m=this.corners[i].material as THREE.MeshBasicMaterial; m.opacity += ((hits.includes(this.zones[i+1]) ? 1 : looking ? .35 : 0)-m.opacity)*k; }
    const active = hits.includes(this.zones[0]);
    const material=this.bar.material as THREE.MeshBasicMaterial;
    material.opacity += ((active ? 1 : .6)-material.opacity)*k;
    this.bar.scale.x += ((active ? 1.3 : 1)-this.bar.scale.x)*k;
  }
  dispose():void {disposeObjectTrees([this.object,this.pinLines,this.scanLines]);}
}

export function panelIcon(segments: readonly (readonly [number, number])[]): THREE.Mesh {
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i < segments.length; i += 2) {
      const a = segments[i], b = segments[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      const nx = -dy / length * ARM_PANEL_STYLE.iconStrokeM / 2;
      const ny = dx / length * ARM_PANEL_STYLE.iconStrokeM / 2, offset = vertices.length / 3;
      vertices.push(a[0]+nx,a[1]+ny,0,a[0]-nx,a[1]-ny,0,b[0]+nx,b[1]+ny,0,b[0]-nx,b[1]-ny,0);
      indices.push(offset,offset+1,offset+2,offset+2,offset+1,offset+3);
    }
    const iconGeometry = new THREE.BufferGeometry();
    iconGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    iconGeometry.setIndex(indices);
    iconGeometry.center();
    const icon = new THREE.Mesh(iconGeometry, new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, side:THREE.DoubleSide, depthTest:false,depthWrite:false,toneMapped:false}));

    icon.renderOrder=66;icon.raycast=()=>{};
 return icon;
}

/** MainUI window chrome, shared by compact robot controls. */
export function panelChrome(parent: THREE.Object3D, radius: number, size = 1) {
  const material = () => new THREE.MeshBasicMaterial({color:0xd1d1d6,transparent:true,opacity:.6,depthWrite:false,side:THREE.DoubleSide});
  const shape = new THREE.Shape(); const w=.12*size,r=.0065*size;
  shape.absarc(-w/2+r,0,r,Math.PI/2,Math.PI*1.5,false);
  shape.absarc(w/2-r,0,r,-Math.PI/2,Math.PI/2,false); shape.closePath();
  const bar = new THREE.Mesh(new THREE.ShapeGeometry(shape),material()); bar.raycast=()=>{}; parent.add(bar);
  const zone = (w:number,h:number) => { const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({visible:false})); m.userData.rayPriority=UI_CONTROL_RAY_PRIORITY; registerRayTarget(m);parent.add(m);return m; };
  const corner = (side:number) => { const m = new THREE.Mesh(new THREE.RingGeometry(radius+.012*size,radius+.019*size,24,1,side>0?-Math.PI/2:Math.PI,Math.PI/2),material());m.material.opacity=0;m.raycast=()=>{};parent.add(m);return m; };
  return {bar,barZone:zone(.22*size,.05*size),cornerArcs:{left:corner(-1),right:corner(1)},cornerZones:{left:zone(.09*size,.09*size),right:zone(.09*size,.09*size)}};
}
