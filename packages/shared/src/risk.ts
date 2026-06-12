/**
 * Risk levels assigned to every tool. Higher = more dangerous.
 *
 *  0: read only
 *  1: safe write draft (no existing data destroyed)
 *  2: file modification
 *  3: shell / agent / network write
 *  4: destructive / publish / deploy / external irreversible action
 */
export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export const RISK_LABELS: Record<RiskLevel, string> = {
  0: "read-only",
  1: "safe-write-draft",
  2: "file-modification",
  3: "shell/agent/network-write",
  4: "destructive/publish/deploy",
};

/**
 * MCP tool annotation hints (subset of the spec's ToolAnnotations) that clients
 * such as ChatGPT use to decide whether a tool call needs a confirmation /
 * "safety check" before running. Without these hints a client must assume the
 * worst — that any tool may mutate or destroy data — and gates even read-only
 * calls (e.g. `git_status`) behind a confirmation prompt.
 */
export interface ToolHintAnnotations {
  /** Tool does not modify its environment. */
  readOnlyHint: boolean;
  /** Tool may perform destructive (irreversible) updates. Only meaningful when not read-only. */
  destructiveHint: boolean;
  /** Repeating the call with the same args has no additional effect. */
  idempotentHint: boolean;
  /** Tool interacts with external systems beyond the local machine. */
  openWorldHint: boolean;
}

/** Security mode, mirrored from config to avoid a runtime import cycle. */
export type SecurityModeHint = "strict" | "open" | "yolo";

/**
 * Derive MCP annotation hints from a tool's risk level so clients can skip the
 * confirmation gate for read-only tools and apply the right caution to the rest.
 *
 *  - risk 0 (read-only)            → read-only, idempotent, closed-world
 *  - risk 1 (safe write draft)     → non-destructive write, closed-world
 *  - risk 2 (file modification)    → destructive, closed-world
 *  - risk 3 (shell/network/agent)  → destructive, open-world
 *  - risk 4 (publish/deploy)       → destructive, open-world
 *
 * In `yolo` mode the operator has explicitly opted into zero-friction execution
 * (the gateway runs every tool with no approval gate), so we advertise *all*
 * tools as safe-to-run-unattended — read-only and non-destructive — so the
 * client (e.g. ChatGPT) never interrupts with a confirmation "safety check".
 * These are hints only; the gateway's own pipeline is the real enforcement.
 */
export function toolAnnotationsForRisk(risk: RiskLevel, mode: SecurityModeHint = "open"): ToolHintAnnotations {
 void mode;
  return {
    readOnlyHint: risk === 0,
    destructiveHint: risk >= 2,
    idempotentHint: risk === 0,
    openWorldHint: risk >= 3,
  };
}

export type ApprovalRequirement = "none" | "single" | "double";

export interface RiskPolicy {
  /** Require approval for risk level 1 tools. Default false. */
  approveRisk1: boolean;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = { approveRisk1: false };

/**
 * Determine whether a tool invocation requires local approval and how strong.
 * ChatGPT-side confirmation is never trusted on its own.
 */
export function approvalFor(risk: RiskLevel, policy: RiskPolicy = DEFAULT_RISK_POLICY): ApprovalRequirement {
  switch (risk) {
    case 0:
      return "none";
    case 1:
      return policy.approveRisk1 ? "single" : "none";
    case 2:
    case 3:
      return "single";
    case 4:
      return "double";
    default:
      return "double";
  }
}
