// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { SetupCameraPreviewView } from "../src/presentation/SetupCameraPreviewView";

it("throttles the thumbnail, preserves aspect ratio and only shows a tag guide for marker capture", () => {
  const context = { clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn() };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  const preview = new SetupCameraPreviewView();
  try {
    const frame = { video: document.createElement("video"), width: 1280, height: 960 };
    preview.update(frame, 0.01, true);
    expect(preview.status).toBe("Live");
    expect(preview.guide.visible).toBe(true);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 320, 208);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(preview.image.material.depthWrite).toBe(false);
    const [, x, y, width, height] = context.drawImage.mock.calls[0] as unknown as [unknown, number, number, number, number];
    expect(width / height).toBeCloseTo(4 / 3); expect(x).toBeGreaterThan(0); expect(y).toBe(0);
    preview.update(frame, 0.1, true); expect(context.drawImage).toHaveBeenCalledOnce();
    preview.update(frame, 0.1, false); expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(preview.guide.visible).toBe(false);
    preview.update(null, 0.2, true); expect(preview.image.visible).toBe(false);
  } finally { preview.dispose(); getContext.mockRestore(); }
});
