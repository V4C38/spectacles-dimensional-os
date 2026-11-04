import { expect, it } from "vitest";
import * as THREE from "three";
import { TargetWarning } from "../src/manipulation/TargetWarning";
it("replaces one anchored pill and rejected sphere, expiring after 1.5 seconds",()=>{
 const warning=new TargetWarning(), marker=new THREE.Vector3(1,1,1);
 warning.show(1,"Unreachable",new THREE.Vector3(2,1,1),1);warning.update(marker,1.1);
 expect(warning.object.visible).toBe(true);expect(warning.object.position.y).toBeCloseTo(.935);expect(warning.rejected.position.x).toBe(2);
 warning.show(1,"same response",new THREE.Vector3(3,1,1),2);warning.update(marker,2.6);expect(warning.object.visible).toBe(false);
 warning.show(2,"Joint limit",new THREE.Vector3(4,1,1),3);warning.update(marker,3.2);expect(warning.rejected.position.x).toBe(4);expect(warning.object.visible).toBe(true);warning.dispose();
});
