export type AgentResponseSeverity = "ok" | "warn" | "error";

const ERROR_SUBSTRINGS: readonly string[] = [
  "id is blank",
  "id is too long",
  "unknown marker id",
  "No client pose",
  "No AR client connected",
];

const WARN_SUBSTRINGS: readonly string[] = ["Navigation cancelled"];

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
