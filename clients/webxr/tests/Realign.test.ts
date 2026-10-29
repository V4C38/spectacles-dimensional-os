// @vitest-environment jsdom
import "./fixtures/xrEnvironment";
import { expect, it, vi } from "vitest";
import { DimOSWebXRClient } from "../src/DimOSWebXRClient";
import { BrowserWebSocketTransport } from "../src/websocket/BrowserWebSocketTransport";
import { cameraFixture } from "./fixtures/camera";

it("realign drops the alignment and reruns the localization step", () => {
  const camera = cameraFixture();
  const client = new DimOSWebXRClient({ camera: camera.source, clock: { now: () => 10 }, transport: new BrowserWebSocketTransport({ url: "wss://test/ar" }) });
  client.originStore.setFromLocalizationResult({ type: "localization_result", position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 10 });
  client.ui.flow.finish();
  const restart = vi.spyOn(client.ui, "restartLocalization");
  client.realign();
  expect(client.originStore.hasTrackingOrigin).toBe(false);
  expect(client.ui.setupCompleted).toBe(false);
  expect(client.ui.wizardStep).toBe("localization");
  expect(client.ui.menuOpen).toBe(true);
  expect(restart).toHaveBeenCalledOnce();
  client.dispose();
});
