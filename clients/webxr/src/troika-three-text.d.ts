declare module "troika-three-text" {
  import { Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: number | string;
    anchorX: number | "left" | "center" | "right";
    anchorY: number | "top" | "middle" | "bottom";
    maxWidth: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
