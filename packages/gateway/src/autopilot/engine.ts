import type { AutopilotMode, Config } from "@localant/shared";
import { PathGuard } from "../security/path-guard.js";
import { resolveProviderOrder } from "./settings.js";
import { shouldFallback } from "./fallback-policy.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { AutopilotFallbackReason, PriorAttemptContext } from "./types.js";

const MUTATING_MODES = new Set<AutopilotMode>(["execute", "fix", "pr"]);
const SUMMARY_CHARS = 1200;

export interface AutopilotRunInput {
  task: string;
  cwd: string;
  mode: AutopilotMode;
  constraints?: string;
  timeoutMs?: number;
  sessionId?: string;
}

/** One provider attempt, kept for audit / doctor. The public tool strips
 * `providerId` / `providerLabel` before returning to ChatGPT. */
export interface AutopilotAttempt {
  providerId: string;
  providerLabel: string;
  ok: boolean;
  skipped: boolean;
  failureReason?: AutopilotFallbackReason;
  exitCode?: number | null;
  durationMs?: number;
  note?: string;
}

export interface AutopilotRunResult {
  ok: boolean;
  mode: AutopilotMode;
  cwd: string;
  branch?: string;
  changed: boolean;
  diff: string;
  output: string;
  /** Reason the chain halted without trying further providers (policy refusal). */
  stoppedReason?: AutopilotFallbackReason;
  /** True when every provider was tried and none succeeded. */
  exhausted: boolean;
  attempts: AutopilotAttempt[];
}

/**
 * Orchestrates Autopilot: reads saved settings, runs the primary provider, and
 * advances through fallbacks per the fallback policy. ChatGPT never names a
 * provider — selection happens entirely here.
 */
export class AutopilotEngine {
  private readonly locks = new Set<string>();

  constructor(
    private readonly config: () => Config,
    private readonly providers: ProviderRegistry,
    private readonly pathGuard: PathGuard,
  ) {}

  async run(input: AutopilotRunInput): Promise<AutopilotRunResult> {
    const cfg = this.config();
    const mutating = MUTATING_MODES.has(input.mode);
    // cwd must stay inside the allowed directories. A guard rejection is a
    // safety block — provider-agnostic, so it never triggers fallback.
    const safeCwd = this.pathGuard.assertAccess(input.cwd, mutating ? "write" : "read");

    const order = resolveProviderOrder(cfg);
    if (order.length === 0) {
      throw new Error(
        "No automation provider is enabled. Open the LocalAnt dashboard → Autopilot Settings and enable a provider.",
      );
    }

    if (this.locks.has(safeCwd)) {
      throw new Error(`Autopilot is already running in this directory (${input.cwd}). Wait for it to finish.`);
    }
    this.locks.add(safeCwd);
    try {
      return await this.runChain(order, input, safeCwd);
    } finally {
      this.locks.delete(safeCwd);
    }
  }

  private async runChain(
    order: string[],
    input: AutopilotRunInput,
    safeCwd: string,
  ): Promise<AutopilotRunResult> {
    const policy = this.config().autopilot.fallbackPolicy;
    const attempts: AutopilotAttempt[] = [];
    let prior: PriorAttemptContext | undefined;
    let lastBranch: string | undefined;

    for (const id of order) {
      const provider = this.providers.get(id);
      if (!provider) continue;

      const avail = await provider.available();
      if (!avail.available) {
        attempts.push({ providerId: id, providerLabel: provider.label, ok: false, skipped: true, failureReason: "command_not_found", note: avail.reason });
        if (!shouldFallback(policy, "command_not_found")) {
          return this.halt(input, attempts, "command_not_found", lastBranch, prior);
        }
        prior = { providerId: id, failureReason: "command_not_found", stdoutSummary: "", stderrSummary: avail.reason ?? "" };
        continue;
      }

      const res = await provider.run({
        cwd: safeCwd,
        task: input.task,
        mode: input.mode,
        constraints: input.constraints,
        timeoutMs: input.timeoutMs,
        sessionId: input.sessionId,
        priorContext: prior,
        // Reuse the prior attempt's branch so a fallback continues on it.
        createBranch: lastBranch === undefined,
        branchName: lastBranch,
      });
      if (res.branch) lastBranch = res.branch;

      attempts.push({
        providerId: id,
        providerLabel: provider.label,
        ok: res.ok,
        skipped: false,
        failureReason: res.failureReason,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
      });

      if (res.ok) {
        return {
          ok: true,
          mode: input.mode,
          cwd: input.cwd,
          branch: lastBranch,
          changed: res.changed,
          diff: res.diff,
          output: res.stdout || res.stderr,
          exhausted: false,
          attempts,
        };
      }

      const reason = res.failureReason ?? "non_zero_exit";
      if (!shouldFallback(policy, reason)) {
        return this.halt(input, attempts, reason, lastBranch, prior, res.diff, res.stdout || res.stderr);
      }
      prior = {
        providerId: id,
        failureReason: reason,
        stdoutSummary: res.stdout.slice(-SUMMARY_CHARS),
        stderrSummary: res.stderr.slice(-SUMMARY_CHARS),
        diff: res.changed ? res.diff : undefined,
      };
    }

    // Every provider tried; none succeeded.
    return {
      ok: false,
      mode: input.mode,
      cwd: input.cwd,
      branch: lastBranch,
      changed: Boolean(prior?.diff),
      diff: prior?.diff ?? "",
      output: prior?.stdoutSummary || prior?.stderrSummary || "",
      exhausted: true,
      attempts,
    };
  }

  private halt(
    input: AutopilotRunInput,
    attempts: AutopilotAttempt[],
    reason: AutopilotFallbackReason,
    branch: string | undefined,
    prior: PriorAttemptContext | undefined,
    diff = "",
    output = "",
  ): AutopilotRunResult {
    return {
      ok: false,
      mode: input.mode,
      cwd: input.cwd,
      branch,
      changed: diff.trim().length > 0,
      diff: diff || prior?.diff || "",
      output: output || prior?.stdoutSummary || "",
      stoppedReason: reason,
      exhausted: false,
      attempts,
    };
  }
}
