import { afterEach, expect, it, vi } from "vitest";
import { BrowserMicrophonePermission } from "../src/agent/BrowserMicrophonePermission";

afterEach(() => vi.unstubAllGlobals());

it("reuses the browser grant without opening the microphone", async () => {
  const getUserMedia = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia },
    permissions: { query: vi.fn().mockResolvedValue({ state: "granted" }) },
  });
  const microphone = new BrowserMicrophonePermission(vi.fn());
  microphone.check();
  await vi.waitFor(() => expect(microphone.state).toBe("granted"));
  microphone.request();
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("requests only audio, releases it and ignores an older permission check", async () => {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  let resolveCheck!: (state: { state: PermissionState }) => void;
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia },
    permissions: { query: () => new Promise(resolve => { resolveCheck = resolve; }) },
  });
  const microphone = new BrowserMicrophonePermission(vi.fn());
  microphone.check();
  expect(getUserMedia).not.toHaveBeenCalled();
  microphone.request();
  microphone.request();
  expect(microphone.state).toBe("requesting");
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  await vi.waitFor(() => expect(microphone.state).toBe("granted"));
  expect(track.stop).toHaveBeenCalledOnce();
  resolveCheck({ state: "prompt" });
  await Promise.resolve();
  expect(microphone.state).toBe("granted");
});

it("lets the user retry after denial even without the permissions query", async () => {
  const getUserMedia = vi.fn().mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
    .mockResolvedValueOnce({ getTracks: () => [] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const microphone = new BrowserMicrophonePermission(vi.fn());
  microphone.check();
  microphone.request();
  await vi.waitFor(() => expect(microphone.error).toContain("Allow microphone access"));
  microphone.request();
  await vi.waitFor(() => expect(microphone.state).toBe("granted"));
  expect(microphone.error).toBeNull();
});
