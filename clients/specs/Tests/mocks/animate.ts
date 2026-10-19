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
    options.ended?.();
  }
}
