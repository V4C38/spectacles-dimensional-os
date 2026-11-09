import { expect, it } from "vitest";
import { SetupWizardView } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView";

function fixture(widths: number[]) {
  const positions = widths.map(() => new vec3(0, 0, 0));
  const runs = widths.map((width, index) => ({
    text: `Capability ${index}`, size: 1,
    getBoundingBox() { return { left: 2, getSize: () => ({ x: width * this.size }) }; },
    getSceneObject: () => ({ getTransform: () => ({ setLocalPosition: (position: vec3) => { positions[index] = position; } }) }),
  }));
  const view = Object.assign(Object.create(SetupWizardView.prototype), { capabilityRuns: runs }) as unknown as {
    layoutCapabilityRuns(): boolean;
  };
  return { view, runs, positions };
}

it("packs complete capability labels into at most two centered rows inside the content width", () => {
  const { view, runs, positions } = fixture([24, 30, 20, 28, 24]);
  expect(view.layoutCapabilityRuns()).toBe(true);
  expect(new Set(positions.map(position => position.y)).size).toBe(2);
  runs.forEach((run, index) => {
    const left = positions[index].x + run.getBoundingBox().left;
    expect(left).toBeGreaterThanOrEqual(-40);
    expect(left + run.getBoundingBox().getSize().x).toBeLessThanOrEqual(40);
    expect(run.text).toBe(`Capability ${index}`);
  });
});

it("reduces the native font size together when the complete labels need more than two rows", () => {
  const { view, runs, positions } = fixture([30, 30, 30, 30, 30, 30, 30]);
  expect(view.layoutCapabilityRuns()).toBe(true);
  expect(new Set(positions.map(position => position.y)).size).toBeLessThanOrEqual(2);
  expect(runs[0].size).toBeLessThan(1);
  expect(new Set(runs.map(run => run.size)).size).toBe(1);
});

it("waits for native font measurement before positioning capability runs", () => {
  const { view, positions } = fixture([0, 20]);
  expect(view.layoutCapabilityRuns()).toBe(false);
  expect(positions.every(position => position.x === 0 && position.y === 0)).toBe(true);
});
