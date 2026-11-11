/** Keep the wire source choice explicit; UI labels do not decide hardware admission. */
export function sourceRequest({ selection, address, replay, playback, streams }) {
  return {
    mode: selection.startsWith("device:") ? "device" : selection,
    device_id: selection.startsWith("device:") ? selection.slice(7) : null,
    address: address.trim(), replay: replay.trim() || null, playback,
    streams: { ...streams },
  };
}

export function replayRobot(blueprint) {
  return blueprint === "openyam_ar_planner" ? "openyam" : "go2";
}

export function replayPreferenceKey(robot) {
  return robot === "openyam" ? "openyam_replay" : "replay";
}
