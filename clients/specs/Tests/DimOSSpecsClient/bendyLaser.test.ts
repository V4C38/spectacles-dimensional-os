import { describe, expect, it, vi } from "vitest";
import { cursorLaserFrame, type LaserPointer } from "../../Assets/Scripts/DimOSSpecsClient/presentation/CursorLaserGeometry";
import { laserTubeGeometry } from "../../Assets/Scripts/DimOSSpecsClient/presentation/BendyLaserRenderer";
import { SpecsLaserPresenter } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsLaserPresenter";

function pointer(overrides: Partial<LaserPointer> = {}): LaserPointer {
  return { id: 1, active: true, origin: [0, 0, 0],
    cursor: [0, 0, -100], shown: true, opacity: 1, ...overrides };
}

describe("cursor-attached laser", () => {
  it("starts 10cm from the hand and reaches the cursor on the first frame", () => {
    const p = pointer(), frame = cursorLaserFrame(p)!;
    expect(frame.start).toEqual([0, 0, -10]);
    expect(frame.end).toEqual(p.cursor);
    expect(frame.control).toEqual([0, 0, -55]);
    expect(frame.opacity).toBe(0.45);
  });

  it("stays straight and attached during immediate cursor and hand movement", () => {
    for (const p of [pointer({ cursor: [40, 10, -100] }), pointer({ origin: [30, -10, -20], cursor: [-20, 30, -80] })]) {
      const frame = cursorLaserFrame(p)!;
      expect(frame.end).toEqual(p.cursor);
      expect(frame.control).toEqual(frame.start.map((v, axis) => (v + frame.end[axis]) / 2));
      expect(Math.hypot(...frame.start.map((v, axis) => v - p.origin[axis]))).toBeCloseTo(10);
    }
  });

  it("follows cursor visibility immediately and scales the actual rendered cursor alpha", () => {
    expect(cursorLaserFrame(pointer({ opacity: 0.4 }))!.opacity).toBeCloseTo(0.18);
    expect(cursorLaserFrame(pointer({ shown: false }))).toBeNull();
    expect(cursorLaserFrame(pointer({ opacity: 0 }))).toBeNull();
    expect(cursorLaserFrame(pointer())!.end).toEqual([0, 0, -100]);
  });

  it("clamps the start offset for a close cursor without extending past it", () => {
    const frame = cursorLaserFrame(pointer({ cursor: [0, 0, -5] }))!;
    expect(frame.start).toEqual([0, 0, -4.5]); expect(frame.end).toEqual([0, 0, -5]);
  });

  it.each([
    { active: false }, { cursor: [NaN, 0, 0] },
    { origin: [Infinity, 0, 0] }, { opacity: NaN }, { cursor: [0, 0, 0] },
  ])("hides invalid/inactive pointers immediately: %o", overrides => {
    expect(cursorLaserFrame(pointer(overrides as Partial<LaserPointer>))).toBeNull();
  });
});

it("builds a reusable open tube with valid topology and complete curve/ring UVs", () => {
  const mesh = laserTubeGeometry();
  expect(mesh.vertices.length / 12).toBe(33 * 7);
  expect(mesh.indices).toHaveLength(32 * 6 * 6);
  expect(Math.max(...mesh.indices)).toBeLessThan(mesh.vertices.length / 12);
  expect(mesh.vertices.slice(10, 12)).toEqual([0, 0]);
  expect(mesh.vertices.slice(-2)).toEqual([1, 1]);
});

it("keeps hands independent, hides direct/lost input, and cleans up once", () => {
  const visuals = new Map<number, { apply: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>();
  let pointers = [pointer(), pointer({ id: 2, cursor: [10, 0, -100] })];
  const presenter = new SpecsLaserPresenter({} as SceneObject, () => pointers, (_parent, id) => {
    const visual = { apply: vi.fn(), hide: vi.fn(), destroy: vi.fn() }; visuals.set(id, visual); return visual;
  });
  presenter.tick(); presenter.tick();
  expect(visuals.get(1)!.apply.mock.lastCall![0].end).toEqual(pointers[0].cursor);
  expect(visuals.get(2)!.apply.mock.lastCall![0].end).toEqual(pointers[1].cursor);
  pointers[0].active = false; presenter.tick();
  expect(visuals.get(1)!.hide).toHaveBeenCalled();
  expect(visuals.get(2)!.apply.mock.lastCall![0].opacity).toBe(0.45);
  pointers = [pointers[1]]; presenter.tick();
  expect(visuals.get(1)!.destroy).toHaveBeenCalledOnce();
  presenter.reset(); expect(visuals.get(2)!.hide).toHaveBeenCalled();
  presenter.dispose(); presenter.dispose(); presenter.tick();
  expect(visuals.get(2)!.destroy).toHaveBeenCalledOnce();
});
