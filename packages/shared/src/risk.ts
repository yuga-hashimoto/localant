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
