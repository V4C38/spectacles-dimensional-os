export const COLOR_WHITE = new (globalThis as Record<string, new (...args: number[]) => { x: number; y: number; z: number; w: number }>).vec4(
  1,
  1,
  1,
  1,
);
export const COLOR_SUCCESS = new (globalThis as Record<string, new (...args: number[]) => { x: number; y: number; z: number; w: number }>).vec4(
  0,
  1,
  0,
  1,
);
export const COLOR_MUTED = new (globalThis as Record<string, new (...args: number[]) => { x: number; y: number; z: number; w: number }>).vec4(
  1,
  1,
  1,
  0.55,
);
export const COLOR_ERROR = new (globalThis as Record<string, new (...args: number[]) => { x: number; y: number; z: number; w: number }>).vec4(
  1,
  0,
  0,
  1,
);
export const COLOR_WARN = new (globalThis as Record<string, new (...args: number[]) => { x: number; y: number; z: number; w: number }>).vec4(
  1,
  0.85,
  0,
  1,
);

export const SnapOS2Styles = {
  Primary: "primary",
  PrimaryNeutral: "primary-neutral",
  Special: "special",
};
