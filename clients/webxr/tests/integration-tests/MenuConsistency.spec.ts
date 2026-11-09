import {test, expect} from "@playwright/test";
import {bootstrap} from "./fixtures/Runtime";
import {frameMenu, summonMenu} from "./fixtures/Input";

test("settings and capabilities share heading alignment, typography and physical depth", async ({page}, info) => {
  const fixture = await bootstrap(page, "controller", {manipulation:true});
  try {
    await fixture.localized(); await summonMenu(page); await frameMenu(page,true);
    await page.evaluate(() => {
      const w=window as any, app=w.xb.core.scene.children.find((o:any)=>o.client?.manipulation);
      app.menuAnchor.detach(); app.setupPlacement.pin(); app.mainMenu.settingsOpen=true;
      w.questDevice.controllers.right.position.set(1,.5,-.2); w.questDevice.controllers.left.position.set(-1,.5,-.2);
    });
    await page.waitForTimeout(700);
    const read=()=>page.evaluate(()=>{
      const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation), menu=app.mainMenu;
      const p=menu.plate.getWorldPosition(menu.plate.position.clone()), q=menu.panel.getWorldQuaternion(menu.panel.quaternion.clone());
      const normal=p.clone().set(0,0,1).applyQuaternion(q), axis=p.clone().set(1,0,0).applyQuaternion(q), rows:any[]=[];
      const controlLeft=menu.localize.localToWorld(p.clone().set(-menu.localize.rangeX/2,0,0)).sub(menu.localize.parent.getWorldPosition(p.clone())).dot(axis)/menu.localize.parent.getWorldScale(p.clone()).x;
      menu.appearanceRoot.traverse((node:any)=>{if(node.userData.sectionHeading){
        const position=node.getWorldPosition(node.position.clone());
        rows.push({text:node.text,x:node.textObj.getWorldPosition(p.clone()).sub(node.parent.getWorldPosition(p.clone())).dot(axis)/node.parent.getWorldScale(p.clone()).x,referenceLeft:controlLeft,font:node.fontSize,color:node.fontColor,depth:position.sub(p).dot(normal)});
      }});
      return rows;
    });
    const rows=await read();
    await page.screenshot({path:info.outputPath("settings-unified.png")});
    expect(rows.map(x=>x.text).sort()).toEqual(["Movement speed","Headset","LiDAR"].sort());
    for(const row of rows){
      expect(row.x).toBeCloseTo(row.referenceLeft,6); expect(row.font).toBeCloseTo(rows[0].font,6);
      expect(row.color).toBe("#aeaeb2"); expect(row.depth).toBeCloseTo(.006,5);
    }
    await page.screenshot({path:info.outputPath("settings-unified.png")});
    await page.evaluate(()=>{const app=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation);app.mainMenu.settingsOpen=false;app.mainMenu.sensorsOpen=true;});
    await page.waitForTimeout(700);
    const buttons=await page.evaluate(()=>{
      const menu=(window as any).xb.core.scene.children.find((o:any)=>o.client?.manipulation).mainMenu;
      const p=menu.plate.getWorldPosition(menu.plate.position.clone()), normal=p.clone().set(0,0,1).applyQuaternion(menu.panel.getWorldQuaternion(menu.panel.quaternion.clone()));
      return menu.sensorControls.map((node:any)=>node.getWorldPosition(node.position.clone()).sub(p).dot(normal));
    });
    for(const depth of buttons) expect(depth).toBeLessThanOrEqual(.006);
    await page.screenshot({path:info.outputPath("sensors-unified.png")});
  } finally {fixture.close();}
});
