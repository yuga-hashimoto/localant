import type { AutopilotFallbackPolicyT, AutopilotFallbackReason } from "@localant/shared";

const REASON_TO_FLAG: Record<AutopilotFallbackReason, keyof AutopilotFallbackPolicyT> = {
  timeout: "onTimeout",
  non_zero_exit: "onNonZeroExit",
  empty_output: "onEmptyOutput",
  no_changes: "onNoChanges",
  rate_limit: "onRateLimit",
  command_not_found: "onCommandNotFound",
  auth_error: "onAuthError",
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

// Signatures observed from real CLI runs that exit 0 while doing no work:
//   claude   → "Not logged in · Please run /login"
//   codex    → "Missing Authorization header", "invalid_token",
//              "Unsupported service_tier: flex"
//   openclaw → "OAuth token refresh failed", "invalid_grant", "re-authenticate"
const AUTH_ERROR_RE =
  /(not logged in|please run\s+\/login|unauthori[sz]ed|invalid[_\s-]?token|invalid[_\s-]?grant|missing authorization|auth(?:entication)?\s+required|authrequired|re-?authenticate|token refresh failed|\binvalid api key\b|\bno api key\b|api key (?:not|is) |\b401\b|unsupported service_tier)/i;
/**
 * Heuristic: did the agent emit an authentication / provider-config error even
 * though it exited 0? Several CLIs print the error to stdout/stderr and still
 * return exit 0, which would otherwise be mistaken for a successful answer.
 */
export function looksAuthError(text: string): boolean {
  return AUTH_ERROR_RE.test(text);
}
