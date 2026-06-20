import { describe, it, expect, vi } from "vitest";
import { Signal } from "../../Assets/Scripts/Core/Utilities";

describe("Signal", () => {
  it("calls listeners with emitted values", () => {
    const signal = new Signal<number>();
    const seen: number[] = [];
    signal.add((value) => seen.push(value));
    signal.emit(1);
    signal.emit(2);
    expect(seen).toEqual([1, 2]);
  });

  it("notifies multiple listeners", () => {
    const signal = new Signal<string>();
    const a = vi.fn();
    const b = vi.fn();
    signal.add(a);
    signal.add(b);
    signal.emit("x");
    expect(a).toHaveBeenCalledWith("x");
    expect(b).toHaveBeenCalledWith("x");
  });

  it("unsubscribe removes a listener", () => {
    const signal = new Signal<number>();
    const listener = vi.fn();
    const off = signal.add(listener);
    off();
    signal.emit(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not skip other listeners when one removes itself during emit", () => {
    const signal = new Signal<number>();
    const other = vi.fn();
    const offSelf = signal.add(() => {
      offSelf();
    });
    signal.add(other);
    signal.emit(1);
    expect(other).toHaveBeenCalledWith(1);
  });

  it("isolates throwing listeners", () => {
    const printSpy = vi.fn();
    (globalThis as Record<string, unknown>).print = printSpy;
    const signal = new Signal<number>();
    const survivor = vi.fn();
    signal.add(() => {
      throw new Error("boom");
    });
    signal.add(survivor);
    signal.emit(42);
    expect(survivor).toHaveBeenCalledWith(42);
    expect(printSpy).toHaveBeenCalled();
  });
});
