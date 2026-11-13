import { FakeClock, FakeTransport, helloAt, stateFrame } from "./support/SessionFixture";
import { describe, expect, it } from "vitest";
import { requestUserMessage } from "../src/agent/userMessageRequest";
import { ClientTrackingOriginStore } from "../src/localization/clientTrackingOrigin";
import { ARModuleSession } from "../src/websocket/arModuleSession";
import type { Capabilities } from "../src/websocket/protocolTypes";

const STATE = stateFrame();

function readySession(capabilities?: Partial<Capabilities>): {
  session: ARModuleSession;
  transport: FakeTransport;
} {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const session = new ARModuleSession({
    transport,
    clock,
    clientTrackingOriginStore: new ClientTrackingOriginStore(),
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
  session.start();
  session.onTransportOpen();
  session.onTransportText(
    `${JSON.stringify(helloAt(clock.nowS, capabilities))}\n${JSON.stringify(STATE)}\n`,
  );
  return { session, transport };
}

describe("requestUserMessage", () => {
  it("sends user_message_request when agent is available", () => {
    const { session, transport } = readySession({
      agent: { available: true, reason: null },
    });
    requestUserMessage(session, "  go forward  ");
    expect(JSON.parse(transport.texts[transport.texts.length - 1])).toEqual({
      type: "user_message_request",
      text: "go forward",
    });
  });

  it("throws when the session is not ready", () => {
    const session = new ARModuleSession({
      transport: new FakeTransport(),
      clock: new FakeClock(),
      clientTrackingOriginStore: new ClientTrackingOriginStore(),
      config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
    });
    expect(() => requestUserMessage(session, "go")).toThrow(/ready session/);
  });

  it("throws when agent is unavailable", () => {
    const { session } = readySession();
    expect(() => requestUserMessage(session, "go")).toThrow(/capabilities.agent/);
  });
});
