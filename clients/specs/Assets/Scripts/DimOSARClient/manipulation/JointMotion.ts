export function jointDelta(from: number, to: number, continuous: boolean): number {
  const delta = to - from;
  return continuous ? Math.atan2(Math.sin(delta), Math.cos(delta)) : delta;
}
