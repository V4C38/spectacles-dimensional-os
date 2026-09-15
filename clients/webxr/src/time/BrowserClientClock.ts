import type { ClientClock } from "@dimos-ar-client/websocket/hostPorts";

export class BrowserClientClock implements ClientClock {
  now(): number {
    return performance.now() / 1000;
  }
}

export function frameTimeToClientClock(
  frameTimeMs: number,
  clock: ClientClock,
  performanceNowMs: number,
): number {
  if (!Number.isFinite(frameTimeMs)) {
    throw new Error("frame timestamp is not finite");
  }
  return clock.now() + (frameTimeMs - performanceNowMs) / 1000;
}
