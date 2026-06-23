import { vec3, vec4, quat, mat4 } from "../shims/lens-runtime";

let mockNow = 0;
export function setMockTime(t: number): void {
  mockNow = t;
}

const g = globalThis as Record<string, unknown>;
g.component = (target: unknown) => target;
g.input = () => () => {};
g.BaseScriptComponent = class BaseScriptComponent {};
g.vec3 = vec3;
g.vec4 = vec4;
g.quat = quat;
g.mat4 = mat4;
g.getTime = () => mockNow;
g.print = (..._args: unknown[]) => {};
