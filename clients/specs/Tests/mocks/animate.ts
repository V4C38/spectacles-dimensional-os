type AnimateOptions = {
  duration: number;
  easing?: string;
  update?: (t: number) => void;
  ended?: () => void;
};

const pending: AnimateOptions[] = [];

export default function animate(options: AnimateOptions): void {
  pending.push(options);
}

export function flushAnimations(): void {
  const batch = pending.splice(0, pending.length);
  for (const options of batch) {
    options.update?.(1);
    options.ended?.();
  }
}

export function advanceAnimations(progress: number): void {
  for (const options of pending.slice()) options.update?.(Math.max(0, Math.min(1, progress)));
}
