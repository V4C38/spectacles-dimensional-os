/** Log a checkpoint only when a dedupe key changes. */
export function logOnChange(
  store: { key: string },
  key: string,
  log: (message: string) => void,
  message: string,
): void {
  if (store.key === key) {
    return;
  }
  store.key = key;
  log(message);
}

/** Throttle repeated logs to at most once per interval (seconds). */
export function logThrottled(
  lastTime: { value: number },
  intervalS: number,
  log: (message: string) => void,
  message: string,
  now: number = getTime(),
): boolean {
  if (lastTime.value >= 0 && now - lastTime.value < intervalS) {
    return false;
  }
  lastTime.value = now;
  log(message);
  return true;
}
