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
