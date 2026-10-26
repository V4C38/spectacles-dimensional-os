import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FingertipButtons } from "../src/input/FingertipButtons";

function fixture() {
  const scene = new THREE.Group();
  const button = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1)); scene.add(button);
  const source = {}, start = vi.fn(), end = vi.fn();
  const touch = new FingertipButtons({ start, end });
  const move = (z: number, x = 0) => touch.update(source, new THREE.Vector3(x, 0, z), [button], () => true);
  return { button, source, touch, start, end, move };
}

describe("index fingertip buttons", () => {
  it("holds one real press through a slow approach and releases once on withdrawal", () => {
    const f = fixture();
    for (const z of [0.05, 0.02, 0.012, 0.01, 0.007, 0.005, 0.003]) f.move(z);
    expect(f.start).toHaveBeenCalledOnce(); expect(f.end).not.toHaveBeenCalled();
    f.move(0.022);
    expect(f.end).toHaveBeenCalledOnce(); expect(f.end.mock.calls[0][2]).toBe(false);
    f.move(0.006); expect(f.start).toHaveBeenCalledOnce();
    f.move(0.06); f.move(0.03); f.move(0.005);
    expect(f.start).toHaveBeenCalledTimes(2);
  });

  it("cancels a side swipe and does not click a replacement page under the finger", () => {
    const f = fixture(); f.move(0.04); f.move(0.005);
    f.move(0.005, 0.08);
    expect(f.end.mock.calls[0][2]).toBe(true);
    f.move(0.005, 0); expect(f.start).toHaveBeenCalledOnce();
  });

  it("never presses from behind, on first tracking acquisition, or through hidden controls", () => {
    const f = fixture(); f.move(0.005); f.move(-0.02); f.move(0.005);
    expect(f.start).not.toHaveBeenCalled();
    f.button.visible = false; f.move(0.04); f.move(0.005);
    expect(f.start).not.toHaveBeenCalled();
  });

  it("cancels on tracking loss and requires withdrawal before rearming", () => {
    const f = fixture(); f.move(0.04); f.move(0.005);
    f.touch.update(f.source, null, [f.button], () => true);
    expect(f.end.mock.calls[0][2]).toBe(true);
    f.move(0.005); expect(f.start).toHaveBeenCalledOnce();
  });
});

it("does not activate when a panel moves under a stationary fingertip", () => {
  const f = fixture(); f.move(0.04); f.move(0.04);
  f.button.position.z = 0.035; f.move(0.04);
  expect(f.start).not.toHaveBeenCalled();
});
