declare module "xrblocks" {
  import type { Group, Object3D } from "three";

  export class Script extends Group {
    init(): void | Promise<void>;
    update(time?: number, frame?: unknown): void;
    onSelectStart(): void;
    onSelectEnd(): void;
    dispose(): void;
  }

  export class Options {
    enableHands(): void;
    enableUI(): void;
    enablePlaneDetection(): void;
    enableCamera(mode?: string): void;
    controllers: { enabled: boolean };
  }

  export class SpatialPanel extends Group {
    constructor(options: { width: number; height: number; backgroundColor?: string });
    addGrid(): SpatialGrid;
  }

  export interface SpatialGrid {
    addRow(options: { weight: number }): SpatialRow;
  }

  export interface SpatialRow {
    addText(options: { text: string; fontSize?: number }): SpatialText;
    addCol(options: { weight: number }): SpatialRow;
  }

  export interface SpatialText {
    text: string;
    color?: string;
    onSelectEnd?: () => void;
  }

  export const core: {
    camera: Object3D;
    input?: {
      inputSources?: Array<{
        handedness?: string;
        gamepad?: { axes: number[]; buttons: Array<{ pressed: boolean }> };
      }>;
      controllers?: Object3D[];
    };
    controller?: Object3D;
  };

  export const input: {
    hands?: {
      left?: {
        joints?: { wrist?: Object3D };
        wrist?: Object3D;
      };
    };
  };

  export const world: {
    planes?: {
      get(kind: string): Array<{
        position?: { x: number; y: number; z: number };
        quaternion?: { x: number; y: number; z: number; w: number };
        getWorldPosition?: (target: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
        getWorldQuaternion?: (target: {
          x: number;
          y: number;
          z: number;
          w: number;
        }) => { x: number; y: number; z: number; w: number };
      }>;
    };
  };

  export function add(script: Script): void;
  export function init(options: Options): void;
}
