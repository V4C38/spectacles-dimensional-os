/** Same physical cloud and native-distance fade contract for each rendering adapter. */
export const LIDAR_PRESENTATION_TRACE = [
  { scale: 1.25, expectedAlpha: 0.5 },
  { scale: 1, expectedAlpha: 2 / 27 },
] as const;
export const LIDAR_TRACE_POINT = [1, 0, 0.4] as const;
