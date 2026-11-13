import { expect, it, vi } from "vitest";
import { installFixtureCamera } from "../integration-tests/IntegrationV2Fixture";
import { SpecsCameraSource } from "../../Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraSource";
import { LocalizationCaptureEpisode } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/LocalizationCaptureEpisode";
import { ClientTrackingOriginStore } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import { ARModuleSession } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ARModuleSession";
import { FakeClock, FakeTransport, helloAt } from "../../../core/tests/support/SessionFixture";

it("routes native fixture capture through the actual source held by an encapsulated Core episode", async () => {
  const clock = new FakeClock(), transport = new FakeTransport(), origins = new ClientTrackingOriginStore();
  const session = new ARModuleSession({ transport, clock, clientTrackingOriginStore: origins });
  session.start(); session.onTransportOpen();
  session.onTransportText(JSON.stringify(helloAt(0)) + "\n"); session.tick();
  const stream = {
    start: vi.fn(() => { throw new Error("native camera must stay off"); }),
    stop: vi.fn(), requestNextFrame: vi.fn(() => { throw new Error("native frame must not be requested"); }),
    deviceCamera: () => null,
  };
  const source = new SpecsCameraSource({ stream: stream as never, cameraObject: {} as SceneObject });
  const nativeCapture = source.capture;
  // Install after construction, matching native scenario preparation after OnStart.
  const episode = new LocalizationCaptureEpisode({ session, clientTrackingOriginStore: origins,
    clock, tracking: source, capture: source, initiallyPaused: true });
  const observation = { ts_capture: 0.1, jpeg: new Uint8Array([255, 216, 255, 217]),
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240, width: 640, height: 480,
      distortion_model: "none" as const, distortion: [] },
    camera_position: [0, 0, 0] as [number, number, number],
    camera_orientation: [0, 0, 0, 1] as [number, number, number, number] };
  const capture = vi.fn(async (canEncode = () => true) => {
    expect(canEncode()).toBe(true);
    return observation;
  });
  const restore = installFixtureCamera(source, capture);
  const submitted = vi.spyOn(session, "submitLocalizationObservations");
  try {
    episode.requestStart();
    session.onTransportText(JSON.stringify({ type: "localization_observations_request",
      capture_id: "fixture-camera", capture_policy: "any_angle", observation_count: 1, result_timeout_s: 15 }) + "\n");
    session.tick(); episode.tick();
    await Promise.resolve(); await Promise.resolve();
    expect(capture).toHaveBeenCalledOnce();
    expect(episode.view().phase).toBe("awaiting_result");
    expect(submitted).toHaveBeenCalledWith([observation], 15);
    expect(stream.start).not.toHaveBeenCalled();
    expect(stream.requestNextFrame).not.toHaveBeenCalled();
  } finally {
    episode.dispose(); session.stop(); restore(); restore();
  }
  expect(source.capture).toBe(nativeCapture);
  expect(Object.getOwnPropertyDescriptor(source, "capture")).toBeUndefined();
});
