import { expect, it, vi } from "vitest";
import { OperatingModeController } from "../src/presentation/ControlPanelPresentation";
import type { ARModuleSessionState } from "../src/websocket/ARModuleSession";

it("rejects Agent selection without its advertised capability even if shared mode is malformed", () => {
  const request = vi.fn(), mode = new OperatingModeController();
  const view = { connection: "ready", capabilities: { agent: { available: false } },
    interaction: { mode: "agent" } } as ARModuleSessionState;
  expect(mode.effective(view)).toBe("manual");
  expect(() => mode.set(view, "agent", request)).toThrow("not available");
  expect(request).not.toHaveBeenCalled();
});
