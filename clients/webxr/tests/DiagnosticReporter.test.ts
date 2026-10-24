import { expect, it, vi } from "vitest";
import { DiagnosticReporter, validDiagnosticEntry } from "../src/diagnostics/DiagnosticReporter";

it("silences traces by default, preserves severity, and reports repeated failures after cooldown", () => {
  let now = 0, verbose = false;
  const emit = vi.fn(), reporter = new DiagnosticReporter({ now: () => now, verbose: () => verbose, emit });
  reporter.report("panel-visible", { position: [1, 2, 3] }); expect(emit).not.toHaveBeenCalled();
  reporter.report("camera", { message: "denied" }, "warn");
  reporter.report("camera", { message: "denied" }, "warn");
  now = 31; reporter.report("camera", { message: "denied" }, "warn");
  expect(emit.mock.calls[1][0]).toMatchObject({ level: "warn", suppressed: 1 });
  verbose = true; reporter.report("panel-visible", { x: 1 }); reporter.report("panel-visible", { x: 2 });
  expect(emit).toHaveBeenCalledTimes(3);
  now += 1; reporter.report("panel-visible", { x: 3 }); expect(emit).toHaveBeenCalledTimes(4);
  reporter.report("ray-select"); now += 0.1; reporter.report("ray-select"); now += 0.2; reporter.report("ray-select");
  expect(emit).toHaveBeenCalledTimes(6);
  for (let i = 0; i < 200; i++) reporter.report("error", { message: String(i) }, "error");
  reporter.report("camera", { message: "denied" }, "warn"); expect(emit.mock.calls.at(-1)![0].event).toBe("camera");
  expect(validDiagnosticEntry({ event: "x", level: "error" })).toBe(true);
  expect(validDiagnosticEntry({ event: "x", level: "info" })).toBe(false);
});
