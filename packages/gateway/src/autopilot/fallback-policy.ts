import type { AutopilotFallbackPolicyT, AutopilotFallbackReason } from "@localant/shared";

const REASON_TO_FLAG: Record<AutopilotFallbackReason, keyof AutopilotFallbackPolicyT> = {
  timeout: "onTimeout",
  non_zero_exit: "onNonZeroExit",
  empty_output: "onEmptyOutput",
  no_changes: "onNoChanges",
  rate_limit: "onRateLimit",
  command_not_found: "onCommandNotFound",
  safety_block: "onSafetyBlock",
  approval_required: "onApprovalRequired",
};

/** Whether the policy permits advancing to the next provider for this reason. */
export function shouldFallback(policy: AutopilotFallbackPolicyT, reason: AutopilotFallbackReason): boolean {
  return policy[REASON_TO_FLAG[reason]] === true;
}

const RATE_LIMIT_RE = /(rate.?limit|usage.?limit|quota|too many requests|\b429\b|overloaded|insufficient_quota)/i;
/** Heuristic: did the agent fail because it hit a provider rate/usage limit? */
export function looksRateLimited(text: string): boolean {
  return RATE_LIMIT_RE.test(text);
}

const NOT_FOUND_RE = /(enoent|command not found|not found|no such file|is not recognized)/i;
/** Heuristic: did spawning the agent fail because its CLI is missing? */
export function looksCommandNotFound(text: string): boolean {
  return NOT_FOUND_RE.test(text);
}
