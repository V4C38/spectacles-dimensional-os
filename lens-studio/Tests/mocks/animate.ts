export default function animate(_options: {
  duration: number;
  easing?: string;
  update?: (t: number) => void;
  ended?: () => void;
}): void {
  // Test no-op: scale animation helpers are not exercised in unit tests.
}
