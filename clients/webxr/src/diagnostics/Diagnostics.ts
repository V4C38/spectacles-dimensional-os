

export type DiagnosticLevel = "debug" | "warn" | "error";
export type DiagnosticEntry = { event: string; level: DiagnosticLevel; suppressed?: number } & Record<string, unknown>;

/** Bounded, opt-in tracing shared by console and development-server delivery. */
export class DiagnosticReporter {
  private readonly recent = new Map<string, { at: number; suppressed: number }>();
  constructor(private readonly options: {
    verbose: () => boolean;
    now: () => number;
    emit: (entry: DiagnosticEntry) => void;
  }) {}

  report(event: string, details: Record<string, unknown> = {}, level: DiagnosticLevel = "debug"): void {
    if (level === "debug" && !this.options.verbose()) return;
    const key = level === "debug" && (event === "panel-visible" || event === "ray-select")
      ? event : JSON.stringify([level, event, details]);
    const interval = level !== "debug" ? 30 : event === "ray-select" ? 0.25 : 1;
    const now = this.options.now();
    const prior = this.recent.get(key);
    if (prior && now - prior.at < interval) { prior.suppressed++; return; }
    this.recent.delete(key);
    if (this.recent.size >= 128) this.recent.delete(this.recent.keys().next().value!);
    this.recent.set(key, { at: now, suppressed: 0 });
    this.options.emit({ ...details, event, level, ...(prior?.suppressed ? { suppressed: prior.suppressed } : {}) });
  }
}

export function validDiagnosticEntry(value: unknown): value is DiagnosticEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.event === "string" && entry.event.length <= 100 &&
    (entry.level === "debug" || entry.level === "warn" || entry.level === "error");
}

const reporter = new DiagnosticReporter({
  verbose: () => typeof location !== "undefined" && new URLSearchParams(location.search).get("diagnostics") === "1",
  now: () => performance.now() / 1000,
  emit: entry => {
    console[entry.level]("[WebXR]", entry);
    import.meta.hot?.send("dimos:webxr-diagnostic", entry);
  },
});

/** Routine traces are silent unless ?diagnostics=1 is explicitly requested. */
export function reportDiagnostic(event: string, details: Record<string, unknown> = {}, level: DiagnosticLevel = "debug"): void {
  reporter.report(event, details, event === "camera-preflight-failed" || (event === "connection" && details.phase === "failed") ? "warn" : level);
}

export function reportBrowserError(error: unknown): void {
  reporter.report("error", { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, "error");
}
