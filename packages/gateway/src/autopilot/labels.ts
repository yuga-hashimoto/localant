/**
 * Friendly provider labels. Shown ONLY where naming the backend is allowed:
 * the Web UI and localant_doctor / debug surfaces. The public `autopilot` tool
 * description, schema, and ChatGPT-facing result never use these.
 */
const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  openclaw: "OpenClaw",
  "antigravity-cli": "Antigravity (agy)",
  "hermes-agent": "Hermes Agent",
};

/** Human label for a provider id, falling back to the id itself. */
export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}
