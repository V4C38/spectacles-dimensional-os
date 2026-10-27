export type HandType = "left" | "right";

export type MockHand = {
  isTracked: () => boolean;
  getPalmPitchAngle: () => number;
  isFacingCamera: () => boolean;
  handType?: HandType;
  indexTip?: { position: vec3 };
  thumbTip?: { position: vec3 };
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
let hands: Partial<Record<HandType, MockHand>> = {};

export function setMockHand(hand: MockHand | null): void {
  mockHand = hand ?? idleHand;
  hands = {};
}

export function setMockHands(value: Partial<Record<HandType, MockHand>>): void { hands = value; mockHand = idleHand; }

export class HandInputData {
  static getInstance(): HandInputData {
    return new HandInputData();
  }

  getHand(handType: string): MockHand {
    return hands[handType as HandType] ?? mockHand;
  }
}
