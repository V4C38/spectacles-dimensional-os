// XR Blocks constructs its audio listener at import time; jsdom has no audio backend.
class AudioContextStub {
  destination = {};
  createGain() { return { connect() {}, gain: { value: 1 } }; }
}
Object.defineProperty(window, "AudioContext", { value: AudioContextStub, configurable: true });
