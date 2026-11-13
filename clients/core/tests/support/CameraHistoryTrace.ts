/** Physical capture-time cases consumed through each platform camera adapter. */
export const CAMERA_HISTORY_TRACE = [
  { name: "interpolates exposure between fresh samples", times: [0.95, 1.05], timestamp: 1, expectedX: 0.5 },
  { name: "uses nearby latest tracking", times: [1], timestamp: 1.05, expectedX: 0 },
  { name: "rejects stale extrapolation", times: [1], timestamp: 1.2, expectedX: null },
  { name: "preserves delayed native exposure interpolation", times: [0, 2], timestamp: 1,
    expectedX: 0.5, webxrExpectedX: null },
] as const;
