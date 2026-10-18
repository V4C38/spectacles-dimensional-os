export type HandType = "left" | "right";

export type MockHand = {
  isTracked: () => boolean;
  getPalmPitchAngle: () => number;
  isFacingCamera: () => boolean;
  handType?: HandType;
  wrist?: { position: { x: number; y: number; z: number } };
  middleMidJoint?: { position: { x: number; y: number; z: number } };
  indexMidJoint?: { position: { x: number; y: number; z: number } };
};

const idleHand: MockHand = {
  isTracked: () => false,
  getPalmPitchAngle: () => 0,
  isFacingCamera: () => false,
};

let mockHand: MockHand = idleHand;

export function setMockHand(hand: MockHand | null): void {
  mockHand = hand ?? idleHand;
}

export class HandInputData {
  static getInstance(): HandInputData {
    return new HandInputData();
  }

  getHand(_handType: string): MockHand {
    return mockHand;
  }
}
