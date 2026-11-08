import { expect, it } from "vitest";
import { EndEffectorStatus, type EndEffectorStatusInput } from "../../../Assets/Scripts/DimOSARClient/manipulation/EndEffectorStatus";

const ready: EndEffectorStatusInput = { blocked: false, fresh: true, stopped: false,
  moving: false, rejection: null };

it("keeps a repeated semantic warning visible without restarting its animation", () => {
  const status = new EndEffectorStatus();
  const input = { ...ready, rejection: { message: "IK failed" } };
  expect(status.sample(input, 1).opacity).toBe(0);
  expect(status.sample(input, 1.06).opacity).toBeCloseTo(0.5);
  const repeated = status.sample({ ...input, rejection: { message: "IK failed" } }, 3);
  expect(repeated.opacity).toBe(1);
  expect(repeated.elapsedS).toBe(2);
  expect(repeated.notification?.glyph).toBe("warning");
  status.sample(ready, 3.1);
  expect(status.sample(ready, 3.19).opacity).toBeCloseTo(0.5);
  expect(status.sample(ready, 3.3).notification).toBeNull();
});

it("derives blocking before advisory failure and preserves the separate stopped notification", () => {
  const status = new EndEffectorStatus();
  expect(status.sample({ ...ready, blocked: true, rejection: { message: "IK failed" } }, 1)
    .notification?.text).toBe("Arm in use");
  expect(status.sample({ ...ready, blocked: true, moving: true }, 2).notification?.text).toBe("Arm moving");
  expect(status.sample({ ...ready, fresh: false, blocked: true }, 3).notification?.text).toBe("No feedback");
  status.sample({ ...ready, stopped: true }, 4);
  expect(status.sample({ ...ready, stopped: true }, 4.2).notification).toBeNull();
});
