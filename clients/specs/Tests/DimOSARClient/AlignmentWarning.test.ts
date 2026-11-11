import { expect, it, vi } from "vitest";
import { AlignmentWarning } from "../../Assets/Scripts/DimOSARClient/presentation/NotificationCenter";

it("shows only beyond five metres and does not repeatedly restart the warning", () => {
  const warning = new AlignmentWarning(), view = { show: vi.fn(), clear: vi.fn() };
  for (const distance of [null, 0, 4.99, 5]) warning.update(distance, false, "idle", view);
  expect(view.show).not.toHaveBeenCalled();
  warning.update(5.01, false, "idle", view);
  warning.update(10, false, "idle", view);
  expect(view.show).toHaveBeenCalledTimes(1);
  expect(view.show.mock.calls[0][0].text).toBe("Weak alignment");
  warning.update(5, false, "idle", view);
  expect(view.clear).toHaveBeenLastCalledWith("alignment:weak");
});
it("suppresses VPS warnings while pending, then handles failure, timeout and success", () => {
  const warning = new AlignmentWarning(), view = { show: vi.fn(), clear: vi.fn() };
  warning.update(10, true, "idle", view);
  warning.observe({ type: "localization_observations_request" } as any);
  warning.update(10, true, "awaiting_result", view);
  expect(view.show).not.toHaveBeenCalled();
  warning.update(10, true, "failed", view);
  expect(view.show).toHaveBeenCalledTimes(1);
  warning.observe({ type: "localization_result" } as any);
  warning.update(10, true, "idle", view);
  expect(view.clear).toHaveBeenLastCalledWith("alignment:weak");
  warning.observe({ type: "localization_status", status: "failed" } as any);
  warning.update(10, true, "idle", view);
  expect(view.show).toHaveBeenCalledTimes(2);
});
