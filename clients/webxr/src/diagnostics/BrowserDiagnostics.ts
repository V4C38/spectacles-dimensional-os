import { DiagnosticReporter, type DiagnosticLevel } from "./DiagnosticReporter";

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
