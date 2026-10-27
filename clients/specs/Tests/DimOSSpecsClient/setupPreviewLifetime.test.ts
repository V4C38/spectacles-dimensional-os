import { expect, it, vi } from "vitest";
import { SetupWizardView } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView";

it("releases the camera texture when the preview or setup panel is hidden", () => {
  vi.stubGlobal("vec2", class { constructor(public x: number, public y: number) {} });
  const texture = { getWidth: () => 100, getHeight: () => 80 };
  const preview = { texture: null as unknown, useTexture: false, size: null as unknown };
  const view = Object.assign(Object.create(SetupWizardView.prototype), {
    preview, previewLabel: { text: "" }, hasPreview: false, tick: vi.fn(), heightController: { setVisible: vi.fn() },
  }) as SetupWizardView;
  view.setCameraPreview(texture as Texture); expect(preview.texture).toBe(texture);
  view.setCameraPreview(null); expect(preview.texture).toBeNull(); expect(preview.useTexture).toBe(false);
  view.setCameraPreview(texture as Texture); view.setVisible(false);
  expect(preview.texture).toBeNull(); expect(preview.useTexture).toBe(false);
});
