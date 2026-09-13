export type HandType = "left" | "right";

export class HandInputData {
  static getInstance(): HandInputData {
    return new HandInputData();
  }

  getHand(_handType: string): {
    isTracked: () => boolean;
    getPalmPitchAngle: () => number;
    isFacingCamera: () => boolean;
  } {
    return {
      isTracked: () => false,
      getPalmPitchAngle: () => 0,
      isFacingCamera: () => false,
    };
  }
}
