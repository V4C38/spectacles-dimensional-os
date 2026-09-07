import { describe, expect, it, vi } from "vitest";
import {
  resolveLinePoints,
  sampleQuadraticBezier,
  WorldAnnotationPresenter,
} from "../../Assets/Scripts/App/Agent/WorldAnnotationPresenter";

describe("AnnotationGeometry", () => {
  it("samples quadratic bezier with exact endpoints and lifted midpoint", () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 100, y: 0, z: 0 };
    const points = sampleQuadraticBezier(start, end, 12);
    expect(points).toHaveLength(12);
    expect(points[0]).toEqual(start);
    expect(points[points.length - 1]).toEqual(end);
    const midIndex = Math.floor((points.length - 1) / 2);
    const mid = points[midIndex];
    expect(mid.y).toBeGreaterThan(0);
    // Quadratic bezier X is monotonic for horizontal start→end; midpoint sample is near center.
    expect(mid.x).toBeGreaterThan(40);
    expect(mid.x).toBeLessThan(60);
  });

  it("resolveLinePoints bezier-samples when only two points are given", () => {
    const resolved = resolveLinePoints([
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 10, z: 80 },
    ]);
    expect(resolved.length).toBeGreaterThan(2);
    expect(resolved[0]).toEqual({ x: 0, y: 10, z: 0 });
    expect(resolved[resolved.length - 1]).toEqual({ x: 0, y: 10, z: 80 });
  });

  it("resolveLinePoints passes through polylines with in-between points", () => {
    const input = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ];
    expect(resolveLinePoints(input)).toEqual(input);
  });
});

describe("annotation TTL registry logic", () => {
  it("expires entries after duration", () => {
    type Entry = { expiresAt: number | null };
    const entries = new Map<string, Entry>();
    const now = 100;
    entries.set("a", { expiresAt: now + 5 });
    entries.set("b", { expiresAt: null });
    entries.set("c", { expiresAt: now - 1 });

    for (const [id, entry] of [...entries.entries()]) {
      if (entry.expiresAt !== null && now >= entry.expiresAt) {
        entries.delete(id);
      }
    }

    expect([...entries.keys()].sort()).toEqual(["a", "b"]);
  });
});

describe("WorldAnnotationPresenter.clearAll", () => {
  it("empties the registry and destroys marker roots", () => {
    const destroyRoot = vi.fn();
    const instantiate = vi.fn().mockReturnValue({
      getTransform: () => ({ setWorldPosition: vi.fn() }),
      enabled: false,
      destroy: destroyRoot,
      getComponent: () => null,
      getChildrenCount: () => 0,
      getChild: () => null,
    });
    const presenter = new WorldAnnotationPresenter({
      eventHost: { createEvent: () => ({ bind: vi.fn() }) } as never,
      parent: {} as never,
      markerPrefab: { instantiate } as never,
    });

    expect(
      presenter.apply({
        id: "m1",
        kind: "marker",
        points: [[1, 0, 2]],
        active: true,
      }).ok,
    ).toBe(true);
    expect(
      presenter.apply({
        id: "m2",
        kind: "marker",
        points: [[0, 0, 0]],
        label: "here",
        active: true,
      }).ok,
    ).toBe(true);
    expect(presenter.size()).toBe(2);

    presenter.clearAll();
    expect(presenter.size()).toBe(0);
    expect(destroyRoot).toHaveBeenCalledTimes(2);
  });
});
