import { beforeEach, describe, expect, it, vi } from "vitest";
import { setMockTime } from "../setup/lens-globals";

const mocks = vi.hoisted(() => {
  return { next: () => {}, previous: () => {}, toggle: () => {}, edit: () => {}, footer: vi.fn(), connection: vi.fn(), captureLayout: vi.fn(), initializeInput: vi.fn(), submit: () => {}, input: "" };
});

vi.mock("../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView", () => ({
  SetupWizardStep: { Connect: 1, Localization: 2 },
  SetupWizardView: class {
    bindHandlers(next: () => void, previous: () => void, submit: () => void, toggle: () => void, _retry: () => void, edit: () => void) { mocks.next = next; mocks.previous = previous; mocks.submit = submit; mocks.toggle = toggle; mocks.edit = edit; }
    getInputText() { return mocks.input; }
    clearInput() { mocks.input = ""; }
    setStepContent() {}
    applyStepLayout() {}
    setInputEnabled() {}
    setConnectionToggleVisible() {}
    setStatus() {}
    setCaptureLayout(value: boolean) { mocks.captureLayout(value); }
    setConnectionState(state: unknown) { mocks.connection(state); }
    setConnectionToggleLabel() {}
    initializeInput(text: string, placeholder: string) { mocks.input = text; mocks.initializeInput(text, placeholder); }
    applyFooterState(_step: number, state: unknown) { mocks.footer(state); }
  },
}));

import { SetupWizardController, type SetupWizardControllerDeps } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardController";

function harness(storage = new Map<string, string>(), options: {
  connection?: string; advance?: boolean;
  resolve?: SetupWizardControllerDeps["ipRelayClient"]["resolve"];
} = {}) {
  const view = { connection: options.connection ?? "ready", hasTrackingOrigin: false, hello: null };
  const finished = vi.fn();
  const dismissed = vi.fn();
  const episode = { reset: vi.fn(), pause: vi.fn(), requestStart: vi.fn(), view: () => ({ phase: "capturing" }) };
  const resolve = vi.fn(options.resolve ?? (() => new Promise<import("../../Assets/Scripts/DimOSSpecsClient/IpRelayClient").ResolvedPin | null>(() => {})));
  const session = { view: () => view, start: vi.fn(), stop: vi.fn() };
  const transport = { setUrl: vi.fn() };
  const events: { bind: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; fire: () => void }[] = [];
  const controller = new SetupWizardController({
    panel: { enabled: true, getComponent: () => null, getTransform: () => ({ getLocalScale: () => vec3.one(), setLocalScale: vi.fn() }) },
    script: { createEvent: () => {
      let callback = () => {};
      const event = { bind: vi.fn((fn: () => void) => { callback = fn; }), reset: vi.fn(), cancel: vi.fn(), fire: () => callback() };
      events.push(event); return event;
    } },
    session,
    transport,
    defaultWebsocketIp: "",
    hostStore: {
      has: (key: string) => storage.has(key),
      getString: (key: string) => storage.get(key) ?? "",
      putString: (key: string, value: string) => storage.set(key, value),
      remove: (key: string) => storage.delete(key),
    },
    episode,
    ipRelayClient: { resolve },
    clientTrackingOriginStore: { clear: vi.fn() },
    onFinished: finished,
    onDismissToRuntime: dismissed,
  } as unknown as SetupWizardControllerDeps);
  controller.start(false);
  episode.pause.mockClear();
  if (options.advance !== false) mocks.next();
  setMockTime(1);
  return { controller, view, finished, dismissed, episode, resolve, session, transport, events };
}

beforeEach(() => {
  setMockTime(0);
  mocks.footer.mockClear();
  mocks.initializeInput.mockClear();
});

it("remembers the submitted PIN across wizard instances, including leading zeroes", () => {
  const storage = new Map<string, string>();
  const { controller, view } = harness(storage);
  view.connection = "disconnected";
  controller.start(true);
  mocks.input = " 012345 ";
  mocks.submit();

  harness(storage);
  expect(mocks.initializeInput).toHaveBeenLastCalledWith("012345", "6 Digit PIN code");
});

it("restores the PIN independently of the saved IP when switching modes", () => {
  const storage = new Map([
    ["dimos_ar_module_pin", "012345"],
    ["dimos_ar_module_host", "192.168.1.9"],
  ]);
  const { controller, view } = harness(storage);
  view.connection = "disconnected";
  controller.start(true);
  expect(mocks.input).toBe("012345");
  mocks.toggle();
  expect(mocks.initializeInput).toHaveBeenLastCalledWith("192.168.1.9", "IP Address");
  mocks.toggle();
  expect(mocks.initializeInput).toHaveBeenLastCalledWith("012345", "6 Digit PIN code");
  expect(storage.get("dimos_ar_module_host")).toBe("192.168.1.9");
});

it("does not replace a saved PIN with invalid input", () => {
  const storage = new Map([["dimos_ar_module_pin", "012345"]]);
  const { controller, view } = harness(storage);
  view.connection = "disconnected";
  controller.start(true);
  mocks.input = "12";
  mocks.submit();
  controller.start(true);
  expect(mocks.input).toBe("012345");
});

it("clears the PIN on edit without erasing the remembered PIN", () => {
  const storage = new Map([["dimos_ar_module_pin", "012345"]]);
  const { controller, view } = harness(storage);
  view.connection = "disconnected";
  controller.start(true);
  expect(mocks.input).toBe("012345");
  mocks.edit();
  expect(mocks.input).toBe("");
  controller.start(true);
  expect(mocks.input).toBe("012345");
});

it("preserves the IP address on edit", () => {
  const storage = new Map([["dimos_ar_module_host", "192.168.1.9"]]);
  const { controller, view } = harness(storage);
  view.connection = "disconnected";
  controller.start(true);
  mocks.toggle();
  expect(mocks.input).toBe("192.168.1.9");
  mocks.edit();
  expect(mocks.input).toBe("192.168.1.9");
});

it.each(["", "12345", "1234567", "abcdef"])("ignores an invalid stored PIN (%s)", pin => {
  harness(new Map([["dimos_ar_module_pin", pin]]));
  expect(mocks.initializeInput).toHaveBeenLastCalledWith("", "6 Digit PIN code");
});

describe("setup localization completion", () => {
  it("shows success for 1.5 seconds, then completes once", () => {
    const { controller, view, finished, episode } = harness();
    view.hasTrackingOrigin = true;
    controller.onSessionViewChanged();
    expect(finished).not.toHaveBeenCalled();
    controller.tick();
    expect(finished).not.toHaveBeenCalled();
    setMockTime(2.5);
    controller.tick();
    expect(finished).toHaveBeenCalledTimes(1);
    expect(episode.pause).not.toHaveBeenCalled();
    expect(controller.isVisible()).toBe(false);
    controller.tick();
    controller.onSessionViewChanged();
    setMockTime(2);
    mocks.next();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("keeps Skip available during capture and pauses when it is pressed", () => {
    const { controller, finished, episode } = harness();
    controller.tick();
    expect(finished).not.toHaveBeenCalled();
    expect(mocks.footer).toHaveBeenLastCalledWith(expect.objectContaining({ footerNextLabel: "Skip", footerNextEnabled: true }));
    setMockTime(2);
    mocks.next();
    expect(episode.pause).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("does not complete from a stale origin after disconnect", () => {
    const { controller, view, finished } = harness();
    view.hasTrackingOrigin = true;
    view.connection = "disconnected";
    controller.tick();
    expect(finished).not.toHaveBeenCalled();
  });
});

it("restarts the connection step and clears stale alignment review", () => {
  const { controller, episode } = harness();
  controller.flow.requestAlignmentReview("Tracking resumed");
  controller.start(true);
  expect(controller.flow.completed).toBe(false);
  expect(controller.flow.step).toBe("connect");
  expect(controller.flow.alignmentReview).toBeNull();
  expect(controller.isVisible()).toBe(true);
  expect(episode.pause).toHaveBeenCalled();
});

it("allows immediate Back from runtime setup before Connect completes", () => {
  const { controller, view, dismissed } = harness();
  view.connection = "disconnected";
  controller.start(true);
  expect(mocks.footer).toHaveBeenLastCalledWith(expect.objectContaining({ footerShowPrev: true }));
  mocks.previous();
  expect(controller.isVisible()).toBe(false);
  expect(controller.flow.completed).toBe(true);
  expect(dismissed).toHaveBeenCalledOnce();
});

it("allows Back from alignment after a completed connection is lost", () => {
  const { controller, view } = harness();
  controller.onSessionViewChanged();
  // The completed Connect step stays reachable when alignment loses its link.
  view.connection = "disconnected";
  controller.onSessionViewChanged();
  mocks.previous();
  expect(controller.flow.step).toBe("connect");
  expect(controller.isVisible()).toBe(true);
});

it("shows a yellow prompt on restart without a duplicate waiting message", () => {
  const { controller, view } = harness();
  view.connection = "disconnected";
  controller.start(true);
  expect(mocks.connection).toHaveBeenLastCalledWith(expect.objectContaining({
    text: "Enter a 6-digit PIN", phase: "entry", details: undefined,
  }));
  const state = mocks.connection.mock.calls.at(-1)![0];
  expect(state.color.x).toBe(1);
  expect(state.color.y).toBeGreaterThan(0.5);
});

it("uses the same status line for validation errors and PIN resolution", () => {
  const { controller, view } = harness();
  view.connection = "disconnected";
  controller.start(true);
  mocks.input = "12";
  mocks.submit();
  let state = mocks.connection.mock.calls.at(-1)![0];
  expect(state.phase).toBe("error");
  expect(state.color.y).toBeLessThan(0.5);
  mocks.input = "123456";
  mocks.submit();
  controller.onSessionViewChanged();
  state = mocks.connection.mock.calls.at(-1)![0];
  expect(state.text).toBe("Resolving PIN…");
  expect(state.phase).toBe("entry");
  expect(state.color.y).toBeGreaterThan(0.5);
});

it("does not let a cancelled connection poll replace localization content", () => {
  const { controller } = harness();
  mocks.connection.mockClear();
  (controller as any).onPollFired();
  (controller as any).showConnectStatus();
  expect(mocks.connection).not.toHaveBeenCalled();
  expect(controller.flow.step).toBe("localization");
});

it("keeps the success height stable when session packets arrive during celebration", () => {
  const { controller, view } = harness();
  view.hasTrackingOrigin = true;
  controller.tick();
  mocks.captureLayout.mockClear();
  controller.onSessionViewChanged();
  controller.onSessionViewChanged();
  expect(mocks.captureLayout).not.toHaveBeenCalled();
});

it("restores the runtime localization baseline when Back aborts re-setup", () => {
  const { controller, view } = harness();
  const origin = { position: [1, 2, 3], orientation: [0, 0, 0, 1], confidence: 1, ts: 1 };
  const restore = vi.fn();
  (view as any).hello = { odom_reference_id: "same-odom", robot: { display_name: "Robot" } };
  (controller as any).deps.clientTrackingOriginStore = { T_odom_client: origin, clear: vi.fn(), restore };
  controller.start(true);
  mocks.previous();
  expect(restore).toHaveBeenCalledWith(origin);
});

it.each(["pause", "new-reference"])("does not restore a baseline after %s", reason => {
  const { controller, view } = harness();
  const restore = vi.fn();
  (view as any).hello = { odom_reference_id: "old-odom", robot: { display_name: "Robot" } };
  (controller as any).deps.clientTrackingOriginStore = {
    T_odom_client: { position: [1, 2, 3], orientation: [0, 0, 0, 1], confidence: 1, ts: 1 }, clear: vi.fn(), restore,
  };
  controller.start(true);
  if (reason === "pause") controller.invalidateBaseline();
  else { (view as any).hello = { odom_reference_id: "new-odom", robot: { display_name: "Robot" } }; controller.onSessionViewChanged(); }
  mocks.previous();
  expect(restore).not.toHaveBeenCalled();
});

it("automatically resolves the saved PIN and connects to the relay address on startup", async () => {
  const storage = new Map([["dimos_ar_module_pin", "012345"]]);
  const f = harness(storage, { connection: "disconnected", advance: false,
    resolve: async () => ({ ip: "192.168.1.42", port: 8787 }) });
  expect(f.resolve).toHaveBeenCalledOnce();
  expect(f.resolve).toHaveBeenCalledWith("012345");
  expect(mocks.connection).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Resolving PIN…" }));
  await Promise.resolve();
  expect(f.transport.setUrl).toHaveBeenCalledOnce();
  expect(f.transport.setUrl).toHaveBeenCalledWith("ws://192.168.1.42:8787");
  expect(f.session.start).toHaveBeenCalledOnce();
  expect(storage.get("dimos_ar_module_host")).toBe("192.168.1.42");
});

it.each([undefined, "", "12345", "1234567", "abcdef"])("waits for input when there is no valid saved PIN (%s)", pin => {
  const storage = new Map<string, string>(); if (pin !== undefined) storage.set("dimos_ar_module_pin", pin);
  const f = harness(storage, { connection: "disconnected", advance: false });
  expect(f.resolve).not.toHaveBeenCalled(); expect(f.session.start).not.toHaveBeenCalled();
  expect(mocks.connection).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Enter a 6-digit PIN" }));
});

it("keeps an already connected session instead of trying the saved PIN again", () => {
  const f = harness(new Map([["dimos_ar_module_pin", "012345"]]), { advance: false });
  expect(f.resolve).not.toHaveBeenCalled(); expect(f.session.start).not.toHaveBeenCalled();
});

it("tries the saved PIN again when switching back from IP mode", () => {
  const f = harness(new Map([["dimos_ar_module_pin", "012345"]]), { connection: "disconnected", advance: false });
  mocks.toggle(); mocks.toggle();
  expect(f.resolve.mock.calls).toEqual([["012345"], ["012345"]]);
});

it("retries an unresolved saved PIN using the existing retry timer", async () => {
  const f = harness(new Map([["dimos_ar_module_pin", "012345"]]), { connection: "disconnected", advance: false, resolve: async () => null });
  await Promise.resolve();
  expect(mocks.connection).toHaveBeenLastCalledWith(expect.objectContaining({ text: "PIN did not resolve" }));
  expect(f.events[0].reset).toHaveBeenCalledWith(2);
  f.events[0].fire(); expect(f.resolve).toHaveBeenCalledTimes(2);
});

it("cancels saved-PIN resolution and retries when the user edits the PIN", async () => {
  let complete = (_result: { ip: string; port: number } | null) => {};
  const storage = new Map([["dimos_ar_module_pin", "012345"]]);
  const f = harness(storage, { connection: "disconnected", advance: false,
    resolve: () => new Promise(resolve => { complete = resolve; }) });
  mocks.edit(); complete({ ip: "192.168.1.42", port: 8787 }); await Promise.resolve();
  expect(mocks.input).toBe(""); expect(storage.get("dimos_ar_module_pin")).toBe("012345");
  expect(f.session.start).not.toHaveBeenCalled(); expect(f.transport.setUrl).not.toHaveBeenCalled();
  expect(f.events[0].cancel).toHaveBeenCalled();
  f.events[0].fire(); expect(f.resolve).toHaveBeenCalledOnce();
});

it("ignores saved-PIN results after changing connection modes", async () => {
  let complete = (_result: { ip: string; port: number } | null) => {};
  const f = harness(new Map([["dimos_ar_module_pin", "012345"]]), { connection: "disconnected", advance: false,
    resolve: () => new Promise(resolve => { complete = resolve; }) });
  mocks.toggle(); complete({ ip: "192.168.1.42", port: 8787 }); await Promise.resolve();
  expect(f.transport.setUrl).not.toHaveBeenCalled(); expect(f.session.start).not.toHaveBeenCalled();
});

it("does not connect a late saved-PIN result after skipping setup", async () => {
  let complete = (_result: { ip: string; port: number } | null) => {};
  const f = harness(new Map([["dimos_ar_module_pin", "012345"]]), { connection: "disconnected", advance: false,
    resolve: () => new Promise(resolve => { complete = resolve; }) });
  mocks.next(); complete({ ip: "192.168.1.42", port: 8787 }); await Promise.resolve();
  expect(f.controller.isVisible()).toBe(false); expect(f.finished).toHaveBeenCalledOnce();
  expect(f.transport.setUrl).not.toHaveBeenCalled(); expect(f.session.start).not.toHaveBeenCalled();
});
