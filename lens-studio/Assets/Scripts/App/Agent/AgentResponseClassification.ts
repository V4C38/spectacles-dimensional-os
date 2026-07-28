// ================================================================
/** Classify agent_response text into ok / warn / error for Lens UI. */
// ================================================================

export type AgentResponseSeverity = "ok" | "warn" | "error";

const ERROR_SUBSTRINGS: readonly string[] = [
  "Robot is not connected",
  "World frame is not committed",
  "No odometry available yet",
  "No AR client connected",
  "AR skill timed out",
  "camera transform unavailable",
  "annotation id is required",
  "unsupported annotation kind",
  "annotation points are required",
  "annotation marker prefab is not assigned",
  "marker annotations require exactly one point",
  "line annotations require at least two points",
  "Annotation points must be",
  "draw_world_annotation failed",
  "bridge not ready",
];

const WARN_SUBSTRINGS: readonly string[] = [
  "Navigation cancelled",
];

/**
 * Heuristic severity from bridge/LLM reply text (stable substrings).
 * Case-sensitive matches against known RPC / skill error strings.
 */
export function classifyAgentResponseText(text: string): AgentResponseSeverity {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "ok";
  }
  for (const needle of ERROR_SUBSTRINGS) {
    if (trimmed.includes(needle)) {
      return "error";
    }
  }
  for (const needle of WARN_SUBSTRINGS) {
    if (trimmed.includes(needle)) {
      return "warn";
    }
  }
  return "ok";
}
