const reportedErrors = new Set<string>();

/** Dev-server diagnostics appear in the launcher's existing WebXR process log. */
export function reportDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  const entry = { event, ...details };
  console.info("[WebXR]", entry);
  import.meta.hot?.send("dimos:webxr-diagnostic", entry);
}

export function reportBrowserError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (reportedErrors.has(message) || reportedErrors.size >= 10) return;
  reportedErrors.add(message);
  reportDiagnostic("error", { message, stack: error instanceof Error ? error.stack : undefined });
}
