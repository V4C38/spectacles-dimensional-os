import { expect, type Page } from "@playwright/test";
export async function setSelection(page: Page, value: number): Promise<void> {
  await page.evaluate(async (amount) => {
    const w = window as any;
    if (w.questDevice.primaryInputMode === "controller")
      w.questDevice.controllers.right.updateButtonValue("trigger", amount);
    else w.questDevice.hands.right.updatePinchValue(amount);
    // Input values are sampled by XR frames. Do not release an emulated press
    // before the runtime has observed it, especially under software rendering.
    const session = w.xb.core.renderer.xr.getSession();
    await new Promise<void>((resolve) =>
      session.requestAnimationFrame(() =>
        session.requestAnimationFrame(() => resolve()),
      ),
    );
  }, value);
}

export async function activateButton(
  page: Page,
  field: "setup" | "retry" = "setup",
  distance = 0.4,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((field) => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
        const snap = app.client.ui.snapshot();
        const label = field === "retry" ? snap.wizardStep === "localization" ? "Try again" : "Reconnect" : snap.nextLabel;
        try { w.integrationMenuQueries.button(app.mainMenu, label); }
        catch { return false; }
        return w.integrationMenuQueries.settled(app.mainMenu);
      }, field),
    )
    .toBe(true);
  const activationCount = await page.evaluate(
    ({ field, distance }) => {
      const w = window as any;
      const app = w.xb.core.scene.children.find(
        (object: any) => object.client?.manipulation,
      );
      const snap = app.client.ui.snapshot();
      const label = field === "retry" ? snap.wizardStep === "localization" ? "Try again" : "Reconnect" : snap.nextLabel;
      const button = w.integrationMenuQueries.button(app.mainMenu, label);
      w.integrationSetupButton = button;
      if (button.userData.integrationActivationCount === undefined) {
        button.userData.integrationActivationCount = 0;
        const triggered = button.onTriggered;
        button.onTriggered = function (id: unknown) {
          triggered.call(this, id);
          button.userData.integrationActivationCount++;
        };
      }
      const position = button.getWorldPosition(button.position.clone());
      const input =
        w.questDevice.primaryInputMode === "controller"
          ? w.questDevice.controllers.right
          : w.questDevice.hands.right;
      const rotation = button.getWorldQuaternion(button.quaternion.clone());
      const normal = position.clone().set(0, 0, 1).applyQuaternion(rotation);
      position.addScaledVector(normal, distance);
      input.position.set(position.x, position.y, position.z);
      input.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      return button.userData.integrationActivationCount as number;
    },
    { field, distance },
  );
  // Wait for the actual XR input ray to hover this button before pressing it.
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).integrationSetupButton.ux.isHovered()),
    )
    .toBe(true);
  // XR Blocks fires onTriggered on release. Wait for sampled XR frames on both
  // edges, then assert the callback rather than transient pressed styling.
  await setSelection(page, 1);
  await setSelection(page, 0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).integrationSetupButton.userData.integrationActivationCount),
    )
    .toBe(activationCount + 1);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).integrationSetupButton.ux.isSelected()),
    )
    .toBe(false);
}

export async function pointRuntimeButton(
  page: Page,
  name: string,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const w = window as any;
        const menu = w.xb.core.scene.children.find(
          (object: any) => object.client?.manipulation,
        ).mainMenu;
        try { w.integrationMenuQueries.button(menu, name); }
        catch { return false; }
        return w.integrationMenuQueries.settled(menu);
      }, name),
    )
    .toBe(true);
  await page.evaluate((name) => {
    const w = window as any;
    const app = w.xb.core.scene.children.find(
      (object: any) => object.client?.manipulation,
    );
    const button = w.integrationMenuQueries.button(app.mainMenu, name);
    w.runtimeButton = button;
    const position = button.getWorldPosition(button.position.clone());
    const input =
      w.questDevice.primaryInputMode === "controller"
        ? w.questDevice.controllers.right
        : w.questDevice.hands.right;
    const rotation = button.getWorldQuaternion(button.quaternion.clone());
    position.addScaledVector(
      position.clone().set(0, 0, 1).applyQuaternion(rotation),
      0.4,
    );
    input.position.set(position.x, position.y, position.z);
    input.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }, name);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).runtimeButton.ux.isHovered()),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as any;
        return (
          w.runtimeButton.userData.rayDisabled !== true &&
          w.runtimeButton.parent?.userData.rayDisabled !== true
        );
      }),
    )
    .toBe(true);
}

export async function activateRuntimeButton(
  page: Page,
  name: string,
): Promise<void> {
  await pointRuntimeButton(page, name);
  await setSelection(page, 1);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).runtimeButton.ux.isSelected()),
    )
    .toBe(true);
  await setSelection(page, 0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).runtimeButton.ux.isSelected()),
    )
    .toBe(false);
}

export async function frameMenu(
  page: Page,
  tight = false,
): Promise<{ position: number[]; rotation: number[] }> {
  const saved = await page.evaluate((tight) => {
    const w = window as any;
    const menu = w.xb.core.scene.children.find(
      (object: any) => object.client?.manipulation,
    ).mainMenu;
    const head = w.questDevice;
    const saved = {
      position: [head.position.x, head.position.y, head.position.z],
      rotation: [
        head.quaternion.x,
        head.quaternion.y,
        head.quaternion.z,
        head.quaternion.w,
      ],
    };
    w.xb.core.scene.children
      .find((object: any) => object.client?.manipulation)
      .setupPlacement.pin();
    const center = menu.panel.getWorldPosition(menu.panel.position.clone());
    const scale = menu.panel.getWorldScale(menu.panel.scale.clone());
    const rotation = menu.panel.getWorldQuaternion(
      menu.panel.quaternion.clone(),
    );
    const up = center.clone().set(0, 1, 0).applyQuaternion(rotation);
    center.addScaledVector(up, scale.y * 0.06);
    const normal = up.clone().set(0, 0, 1).applyQuaternion(rotation);
    const distance = Math.max(0.25, (scale.y * (tight ? 0.85 : 1.25)) / (2 * 0.58));
    const eye = center.addScaledVector(normal, distance);
    head.position.set(eye.x, eye.y, eye.z);
    head.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    return saved;
  }, tight);
  await page.waitForTimeout(220);
  return saved;
}

export async function summonMenu(page: Page): Promise<void> {
  const mode = await page.evaluate(
    () => (window as any).questDevice.primaryInputMode,
  );
  if (mode === "controller") {
    await page.evaluate(() =>
      (window as any).questDevice.controllers.left.updateButtonValue(
        "x-button",
        1,
      ),
    );
    await page.waitForTimeout(180);
    await page.evaluate(() =>
      (window as any).questDevice.controllers.left.updateButtonValue(
        "x-button",
        0,
      ),
    );
  } else {
    const orient = async (up: boolean) =>
      page.evaluate(async (up) => {
        const w = window as any,
          app = w.xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
          );
        await new Promise<void>((resolve, reject) =>
          app.session.requestAnimationFrame((_time: number, frame: XRFrame) => {
            try {
              const source = Array.from(
                app.session.inputSources as XRInputSource[],
              ).find((source) => source.handedness === "left" && source.hand)!;
              const position = (name: XRHandJoint) => {
                const p = frame.getJointPose!(
                  source.hand!.get(name)!,
                  app.reference,
                ).transform.position;
                return app.mainMenu.panel.position.clone().set(p.x, p.y, p.z);
              };
              const wrist = position("wrist"),
                middle = position("middle-finger-metacarpal"),
                index = position("index-finger-metacarpal"),
                little = position("pinky-finger-metacarpal");
              const normal = index
                .sub(little)
                .cross(middle.clone().sub(wrist))
                .negate()
                .normalize();
              const delta = app.mainMenu.panel.quaternion
                .clone()
                .setFromUnitVectors(
                  normal,
                  app.mainMenu.panel.position.clone().set(0, up ? 1 : -1, 0),
                );
              const hand = w.questDevice.hands.left,
                current = app.mainMenu.panel.quaternion
                  .clone()
                  .set(
                    hand.quaternion.x,
                    hand.quaternion.y,
                    hand.quaternion.z,
                    hand.quaternion.w,
                  );
              const target = delta.multiply(current);
              hand.quaternion.set(target.x, target.y, target.z, target.w);
              resolve();
            } catch (error) {
              reject(error);
            }
          }),
        );
      }, up);
    await orient(false);
    await page.waitForTimeout(400);
    await orient(true);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
          ).client.ui.menuOpen,
      ),
    )
    .toBe(true);
}
export async function moveInput(
  page: Page,
  delta: number[],
  duration = 800,
  handedness = "right",
): Promise<void> {
  await page.evaluate(
    async ({ delta, duration, handedness }) => {
      const w = window as any,
        input =
          w.questDevice.primaryInputMode === "controller"
            ? w.questDevice.controllers[handedness]
            : w.questDevice.hands[handedness];
      const p = {
          x: input.position.x,
          y: input.position.y,
          z: input.position.z,
        },
        start = performance.now();
      await new Promise<void>((resolve) => {
        const update = () => {
          const t = Math.min(1, (performance.now() - start) / duration),
            e = t * t * (3 - 2 * t);
          input.position.set(
            p.x + delta[0] * e,
            p.y + delta[1] * e,
            p.z + delta[2] * e,
          );
          if (t < 1) requestAnimationFrame(update);
          else resolve();
        };
        update();
      });
    },
    { delta, duration, handedness },
  );
}

export async function scrollResponse(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as any;
        const app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
        const view = w.integrationMenuQueries.response(app.mainMenu, app.client.speech.snapshot().response);
        if (view) w.integrationResponseView = view;
        return view?.maxScroll ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window as any;
    const view = w.integrationResponseView;
    const target = view.bodyHit,
      p = target.getWorldPosition(target.position.clone()),
      q = target.getWorldQuaternion(target.quaternion.clone());
    p.addScaledVector(p.clone().set(0, 0, 1).applyQuaternion(q), 0.4);
    w.questDevice.hands.right.position.set(p.x, p.y, p.z);
    w.questDevice.hands.right.quaternion.set(q.x, q.y, q.z, q.w);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as any,
          app = w.xb.core.scene.children.find(
            (o: any) => o.client?.manipulation,
          );
        return (
          app.interaction.hit(w.xb.core.input.rightController)?.object ===
          w.integrationResponseView.bodyHit
        );
      }),
    )
    .toBe(true);
  await setSelection(page, 1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const app = (window as any).xb.core.scene.children.find(
          (o: any) => o.client?.manipulation,
        );
        return !!app.scrollHold;
      }),
    )
    .toBe(true);
  await moveInput(page, [0, 0.035, 0], 650);
  await setSelection(page, 0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).integrationResponseView.scrollOffset),
    )
    .toBeGreaterThan(0);
}

export async function pointIndexAtButton(page: Page, label: string, distance: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
    return (window as any).integrationMenuQueries.settled(app.mainMenu);
  })).toBe(true);
  await page.evaluate(async ({ label, distance }) => {
    const w = window as any, app = w.xb.core.scene.children.find((o: any) => o.client?.manipulation);
    const button = w.integrationMenuQueries.button(app.mainMenu, label).mesh;
    await new Promise<void>(resolve => app.session.requestAnimationFrame((_time: number, frame: XRFrame) => {
      const source = Array.from(app.session.inputSources as XRInputSource[]).find(s => s.hand && s.handedness === "right")!;
      const tip = frame.getJointPose!(source.hand!.get("index-finger-tip")!, app.reference)!.transform.position;
      const normal = app.mainMenu.panel.position.clone().set(0, 0, 1).applyQuaternion(button.getWorldQuaternion(app.mainMenu.panel.quaternion.clone()));
      const goal = button.getWorldPosition(app.mainMenu.panel.position.clone()).addScaledVector(normal, distance);
      const hand = w.questDevice.hands.right;
      hand.updatePinchValue(0);
      hand.position.set(hand.position.x + goal.x - tip.x, hand.position.y + goal.y - tip.y, hand.position.z + goal.z - tip.z);
      resolve();
    }));
    // Approach, contact and withdrawal must each be observed by rendered XR
    // frames; a fixed delay can expire before even one frame on software GL.
    for (let i = 0; i < 3; i++) await new Promise<void>(resolve => app.session.requestAnimationFrame(() => resolve()));
  }, { label, distance });

}


export async function touchButton(page: Page, label: string): Promise<void> {
  for (const distance of [0.05, 0.02, 0.005, 0.04]) await pointIndexAtButton(page, label, distance);
}
