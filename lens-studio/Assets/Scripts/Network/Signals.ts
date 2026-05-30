export function emit<T>(callbacks: ((value: T) => void)[], value: T): void {
  callbacks.forEach((cb) => cb(value));
}
