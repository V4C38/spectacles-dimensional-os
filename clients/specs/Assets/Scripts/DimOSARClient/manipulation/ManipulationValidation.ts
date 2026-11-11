export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected manipulation object");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128)
    throw new Error("Invalid manipulation identifier");
  return value;
}
export function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid manipulation number");
  return value;
}
export function vector(value: unknown, count: number): number[] {
  if (!Array.isArray(value) || value.length !== count)
    throw new Error("Invalid manipulation vector");
  return value.map(finite);
}
export function pose(value: unknown, path = "pose"): void {
  try {
  const p = object(value);
  vector(p.position, 3);
  const q = vector(p.orientation, 4);
  if (Math.abs(q.reduce((s, v) => s + v * v, 0) - 1) > 1e-4)
    throw new Error("Expected unit quaternion");
  } catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
