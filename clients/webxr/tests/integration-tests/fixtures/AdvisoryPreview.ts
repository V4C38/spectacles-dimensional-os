/** Mock the server's advisory route tolerance without sharing production state. */
export function previewAimChanged(previous: { position: number[]; orientation: number[] } | null, next: { position: number[]; orientation: number[] }): boolean {
  if (!previous) return true;
  const distance = Math.hypot(...previous.position.map((value, i) => value - next.position[i]));
  const dot = Math.abs(previous.orientation.reduce((sum, value, i) => sum + value * next.orientation[i], 0));
  return distance >= 0.2 || 2 * Math.acos(Math.min(1, dot)) >= Math.PI / 12;
}
