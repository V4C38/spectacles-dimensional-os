import { beforeEach } from "vitest";
/** Browser APIs needed when constructing real XR Blocks presentation controls. */
if (typeof window !== "undefined") {
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: class {
      destination = {};
      createGain() { return { connect() {}, gain: { value: 1 } }; }
    },
  });
}

beforeEach(() => { if (typeof window !== "undefined") window.localStorage.clear(); });
