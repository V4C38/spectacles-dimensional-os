export function matchesStopCommand(text: string): boolean {
  return /\bstop\b/i.test(text);
}
