import type { Page, TestInfo } from "@playwright/test";

/** Keep the interaction overview and move only the fixture viewer for readable action evidence. */
export async function captureManipulationDetail(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`${name}-overview.png`) });
  const viewer = await page.evaluate(() => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((object: any) => object.client?.manipulation);
    const handle = app.client.manipulation.renderer.handle.object;
    const center = handle.getWorldPosition(handle.position.clone());
    center.y += 0.025;
    const eye = center.clone().add(center.clone().set(0.10, 0.06, 0.24));
    const orientation = handle.quaternion.clone().setFromUnitVectors(
      center.clone().set(0, 0, -1), center.clone().sub(eye).normalize(),
    );
    const p = w.questDevice.position, q = w.questDevice.quaternion;
    const previous = { position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] };
    w.questDevice.position.set(eye.x, eye.y, eye.z);
    w.questDevice.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    return previous;
  });
  try {
    await renderedFrames(page);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
  } finally {
    await page.evaluate(previous => {
      const device = (window as any).questDevice;
      device.position.set(...previous.position);
      device.quaternion.set(...previous.orientation);
    }, viewer);
    await renderedFrames(page);
  }
}

async function renderedFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const session = (window as any).xb.core.renderer.xr.getSession();
    for (let frame = 0; frame < 3; frame++) {
      await new Promise<void>(resolve => session.requestAnimationFrame(() => resolve()));
    }
  });
}
