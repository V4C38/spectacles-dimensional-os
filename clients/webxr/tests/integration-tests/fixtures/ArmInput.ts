import { expect, type Page } from "@playwright/test";
import { setSelection } from "./Input";

/** Move the emulated viewer and hand; all arm commands still come from real XR hits. */
export async function frameArm(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
    const r = app.client.manipulation.renderer;
    const base = r.baseMarker.getWorldPosition(r.baseMarker.position.clone());
    const tip = r.handle.object.getWorldPosition(r.handle.object.position.clone());
    const center = base.clone().add(tip).multiplyScalar(0.5);
    center.y -= 0.04;
    const distance = Math.max(0.85, base.distanceTo(tip) * 1.5);
    const eye = center.clone().add(center.clone().set(0, 0.15, distance));
    const rotation = r.panel.quaternion.clone().setFromUnitVectors(
      center.clone().set(0, 0, -1), center.clone().sub(eye).normalize(),
    );
    w.questDevice.position.copy(eye);
    w.questDevice.quaternion.copy(rotation);
    w.questDevice.hands.left.position.set(-5, 2, 0);
  });

}

export async function aimArm(page: Page, part: "base" | "handle" | "plan" | "execute" | "gripper" | "stop" | "estop"): Promise<void> {
  if (["plan", "execute", "gripper"].includes(part)) {
    await aimArm(page, "handle");
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      return app.client.manipulation.renderer.gripperMenu.scale.x;
    })).toBeGreaterThan(0.99);
  }
  await page.evaluate(part => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
    const r = app.client.manipulation.renderer;
    const target = part === "handle" ? r.handle.collider : part === "base"
      ? r.baseMarker.children.find((o: any) => o.userData.manipulationLink)
      : r.controlsView.buttons.get(part);
    if (!target) throw new Error(`Missing arm target: ${part}`);
    const position = target.getWorldPosition(target.position.clone());
    const rotation = target.getWorldQuaternion(target.quaternion.clone());
    if (part === "base" || part === "handle") rotation.identity();
    position.addScaledVector(position.clone().set(0, 0, 1).applyQuaternion(rotation), 0.55);
    w.questDevice.hands.right.position.copy(position);
    w.questDevice.hands.right.quaternion.copy(rotation);
  }, part);
  await expect.poll(() => page.evaluate(part => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
    const hit = app.interaction.hit(w.xb.core.input.rightController)?.object;
    if (part === "handle") return hit?.name === "EndEffectorHandleCollider";
    if (part === "base") return !!hit?.userData.manipulationLink;
    const expected = part === "estop" && app.client.session.view().manipulation?.stopped ? "resume" : part;
    return hit?.userData.manipulationAction === expected;
  }, part)).toBe(true);
}

export async function clickArm(page: Page, part: "base" | "plan" | "execute" | "gripper" | "stop" | "estop"): Promise<void> {
  await aimArm(page, part);
  await setSelection(page, 1);
  await setSelection(page, 0);
}
