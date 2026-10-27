import { describe, expect, it, vi } from "vitest";
import { WebXRSessionController } from "../src/WebXRSessionController";

function fixture() {
  let localized = true;
  const session = Object.assign(new EventTarget(), { visibilityState: "visible", inputSources: [] });
  const offset = new EventTarget();
  const original = Object.assign(new EventTarget(), { getOffsetReferenceSpace: vi.fn(() => offset) });
  let reference: XRReferenceSpace = original as unknown as XRReferenceSpace;
  const renderer = { getReferenceSpace: () => reference, setReferenceSpace: vi.fn((value: XRReferenceSpace) => { reference = value; }) };
  const effects = { suspend: vi.fn(), reset: vi.fn(), resume: vi.fn(), recoverUnknownReset: vi.fn(),
    reviewAlignment: vi.fn(), inputSourcesChanged: vi.fn(), detach: vi.fn(), end: vi.fn() };
  const controller = new WebXRSessionController({ renderer: () => renderer, localized: () => localized,
    setupCompleted: () => localized, ...effects });
  let viewer: XRViewerPose | null = { emulatedPosition: false } as XRViewerPose;
  const frame = { getViewerPose: () => viewer } as unknown as XRFrame;
  return { controller, session, original, offset, renderer, effects, frame,
    setViewer: (value: XRViewerPose | null) => { viewer = value; },
    setLocalized: (value: boolean) => { localized = value; } };
}

describe("immersive session lifecycle", () => {
  it("suspends focus loss, retains the reference and resumes with zero visible delta", () => {
    const f = fixture(); f.controller.start(f.session as unknown as XRSession);
    expect(f.controller.sample(0, f.frame)?.deltaS).toBe(0);
    f.session.visibilityState = "hidden"; f.session.dispatchEvent(new Event("visibilitychange"));
    expect(f.controller.tracking).toBe(false);
    expect(f.controller.sample(5000, f.frame)).toBeNull();
    f.session.visibilityState = "visible";
    expect(f.controller.sample(5010, f.frame)?.reference).toBe(f.original);
    expect(f.effects.reset).toHaveBeenCalledOnce();
    expect(f.effects.suspend).toHaveBeenCalledOnce();
    expect(f.effects.reviewAlignment).toHaveBeenCalledWith("headset-resume");
    expect(f.controller.sample(5020, f.frame)?.deltaS).toBeCloseTo(0.01);
  });

  it("compensates reported resets and delegates unknown resets without clearing alignment", () => {
    const f = fixture(); f.controller.start(f.session as unknown as XRSession); f.controller.sample(0, f.frame);
    const inverse = {};
    f.original.dispatchEvent(Object.assign(new Event("reset"), { transform: { inverse } }));
    expect(f.original.getOffsetReferenceSpace).toHaveBeenCalledWith(inverse);
    expect(f.renderer.setReferenceSpace).toHaveBeenCalledWith(f.offset);
    f.controller.sample(10, f.frame);
    f.offset.dispatchEvent(new Event("reset"));
    expect(f.effects.recoverUnknownReset).toHaveBeenCalledOnce();
    expect(f.effects.reset).toHaveBeenCalledOnce();
    expect(f.controller.tracking).toBe(false);
  });

  it("reviews extended pose loss and ignores stale session events after replacement or teardown", () => {
    const f = fixture(); f.controller.start(f.session as unknown as XRSession); f.controller.sample(0, f.frame);
    f.setViewer(null); f.controller.sample(100, f.frame);
    expect(f.controller.tracking).toBe(false);
    f.setViewer({ emulatedPosition: false } as XRViewerPose);
    expect(f.controller.sample(1200, f.frame)?.deltaS).toBe(0);
    expect(f.effects.reviewAlignment).toHaveBeenCalledWith("tracking-loss");
    const replacement = Object.assign(new EventTarget(), { visibilityState: "visible" });
    f.controller.start(replacement as unknown as XRSession);
    f.session.dispatchEvent(new Event("inputsourceschange"));
    expect(f.effects.inputSourcesChanged).not.toHaveBeenCalled();
    replacement.dispatchEvent(new Event("inputsourceschange"));
    expect(f.effects.inputSourcesChanged).toHaveBeenCalledOnce();
    f.controller.end();
    const resets = f.effects.reset.mock.calls.length;
    replacement.dispatchEvent(new Event("visibilitychange")); f.offset.dispatchEvent(new Event("reset"));
    expect(f.effects.reset).toHaveBeenCalledTimes(resets);
    expect(f.controller.session).toBeNull();
    expect(f.controller.tracking).toBe(false);
    expect(f.effects.end).toHaveBeenCalledOnce();
  });
});
