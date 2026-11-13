import { expect, it } from "vitest";
import { HudMessageController } from "../../Assets/Scripts/DimOSSpecsClient/presentation/HudMessageController";
import { setMockTime } from "../setup/lens-globals";

it("expires transient feedback while retaining indefinite feedback", () => {
  setMockTime(10);
  const logger = new HudMessageController();
  logger.show("Connected", new vec4(0, 1, 0, 1), 0.5);
  logger.tick(10.49); expect(logger.snapshot?.text).toBe("Connected");
  logger.tick(10.5); expect(logger.snapshot).toBeNull();
  logger.show("Ready", new vec4(1, 1, 1, 1));
  logger.tick(100); expect(logger.snapshot?.text).toBe("Ready");
  const snapshot = logger.snapshot!; snapshot.color.x = 0;
  expect(logger.snapshot?.color.x).toBe(1);
  logger.clear(); expect(logger.snapshot).toBeNull();
});
