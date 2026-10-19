import { expect, it } from "vitest";
import { PalmMenuGate } from "../src/input/PalmMenuGate";

it("debounces palm-up opening, uses hysteresis, and closes on tracking loss", () => {
  const gate = new PalmMenuGate();
  gate.update(1, 0); expect(gate.isOpen).toBe(false);
  gate.update(1, 0.27); expect(gate.isOpen).toBe(false);
  gate.update(1, 0.29); expect(gate.isOpen).toBe(true);
  gate.update(0.5, 1); expect(gate.isOpen).toBe(true);
  gate.update(0, 2); gate.update(0, 2.05); expect(gate.isOpen).toBe(true);
  gate.update(0, 2.09); expect(gate.isOpen).toBe(false);
  gate.update(1, 3); gate.update(1, 3.3); expect(gate.isOpen).toBe(true);
  gate.update(null, 4); expect(gate.isOpen).toBe(false);
});
