import { expect, it, vi } from "vitest";
import { ARModuleSession } from "../src/websocket/ARModuleSession";
import { ClientTrackingOriginStore } from "../src/localization/ClientTracking";
import { FakeClock, FakeTransport, helloAt } from "./support/SessionFixture";

function fixture() {
  const transport = new FakeTransport(), clock = new FakeClock();
  const session = new ARModuleSession({ transport, clock, clientTrackingOriginStore: new ClientTrackingOriginStore() });
  const frames = vi.spyOn(transport.bulk, "sendText");
  session.start(); session.onTransportOpen();
  session.onTransportText(JSON.stringify({ ...helloAt(0, { agent: { available: true, reason: null } }), speech_transcription: true }) + "\n");
  session.tick();
  const requests = () => frames.mock.calls.map(([text]) => JSON.parse(text));
  const progress = (id: string, status: string, text?: string) => session.onTransportText(JSON.stringify({
    type: "speech_transcription_result", request_id: id, status, ...(text === undefined ? {} : { text }),
  }) + "\n");
  return { session, transport, clock, requests, progress };
}

it("correlates draft transcripts, reports preparation, and never sends an agent command", async () => {
  const f = fixture(), status = vi.fn();
  const request = f.session.transcribeSpeech(new Uint8Array(40), "audio/webm;codecs=opus", status);
  f.session.tick(); f.session.tick();
  const id = f.requests().find(frame => frame.kind === "speech").request_id;
  f.progress("retired", "completed", "wrong recording");
  f.progress(id, "preparing"); expect(status).toHaveBeenCalledWith("preparing");
  f.clock.nowS = 120; f.session.tick(); // Model preparation outlives ordinary speech-finalization windows.
  f.progress(id, "completed", "go home");
  await expect(request.result).resolves.toBe("go home");
  expect(f.transport.texts.some(text => text.includes("user_message_request"))).toBe(false);
});

it("queues speech behind localization and does not cancel it when capture intent retires", async () => {
  const f = fixture();
  f.session.onTransportText(JSON.stringify({ type: "localization_observations_request", capture_id: "camera", capture_policy: "any_angle", observation_count: 1, result_timeout_s: 15 }) + "\n");
  f.session.sendBinary(new Uint8Array(400000));
  const speech = f.session.transcribeSpeech(new Uint8Array(40), "audio/webm");
  expect(f.requests().filter(frame => frame.kind === "speech")).toHaveLength(0);
  for (let index = 0; index < 6; index++) f.session.tick();
  expect(f.requests().filter(frame => frame.kind === "speech")).toHaveLength(1);
  const id = f.requests().find(frame => frame.kind === "speech").request_id;
  f.session.cancelLocalizationSubmission();
  expect(f.requests().filter(frame => frame.type === "bulk_upload_cancel")).toHaveLength(0);
  f.progress(id, "completed", "draft");
  await expect(speech.result).resolves.toBe("draft");
});

it("retires cancellation and disconnection results before another recording", async () => {
  const f = fixture();
  const old = f.session.transcribeSpeech(new Uint8Array(40), "audio/webm");
  const rejected = expect(old.result).rejects.toThrow("cancelled");
  f.session.tick(); old.cancel(); await rejected;
  const next = f.session.transcribeSpeech(new Uint8Array(40), "audio/webm");
  const disconnected = expect(next.result).rejects.toThrow("Disconnected");
  f.session.onTransportClose(); await disconnected;
  expect(f.session.view().connection).toBe("failed");
});
