import type { AutopilotMode, Config } from "@localant/shared";
import { commandExists } from "../util/exec.js";
import type { CodingAgentManager } from "../managers/coding-agent-manager.js";
import type { GitManager } from "../managers/git-manager.js";
import { providerLabel } from "./labels.js";
import { isProviderEnabled } from "./settings.js";
import { looksCommandNotFound, looksRateLimited } from "./fallback-policy.js";
import type {
  AutopilotProvider,
  AutopilotProviderInput,
  AutopilotProviderResult,
  ProviderAvailability,
} from "./types.js";

/** Modes that modify the working tree (need a branch + diff check). */
const MUTATING_MODES = new Set<AutopilotMode>(["execute", "fix", "pr"]);

/**
 * Adapter that exposes one configured coding-agent CLI as an Autopilot
 * provider. The agent CLIs themselves are no longer public tools — they are
 * reachable only through this internal adapter.
 */
export class CodingAgentProvider implements AutopilotProvider {
  readonly supportedModes: AutopilotMode[] = ["plan", "execute", "review", "fix", "pr"];

  constructor(
    readonly id: string,
    private readonly config: () => Config,
    private readonly agents: CodingAgentManager,
    private readonly git: GitManager,
  ) {}

  get label(): string {
    return providerLabel(this.id);
  }

  async available(): Promise<ProviderAvailability> {
    const cfg = this.config().codingAgents[this.id];
    if (!cfg) return { available: false, enabled: false, reason: "unknown provider" };
    const enabled = cfg.enabled && isProviderEnabled(this.config(), this.id);
    const cliPresent = await commandExists(cfg.command);
    let reason: string | undefined;
    if (!enabled) reason = "disabled in settings";
    else if (!cliPresent) reason = `CLI '${cfg.command}' not found on PATH`;
    return { available: enabled && cliPresent, enabled, reason };
  }

  async run(input: AutopilotProviderInput): Promise<AutopilotProviderResult> {
    const mutating = MUTATING_MODES.has(input.mode);
    const stage: "plan" | "execute" = mutating ? "execute" : "plan";
    const started = Date.now();
    const prompt = buildPrompt(input);

    let raw: Awaited<ReturnType<CodingAgentManager["runBlocking"]>>;
    try {
      raw = await this.agents.runBlocking(this.id, {
        cwd: input.cwd,
        prompt,
        stage,
        timeoutMs: input.timeoutMs,
        createBranch: mutating ? input.createBranch : false,
        branchName: input.branchName,
      });
    } catch (e) {
      // Setup failure (disabled / branch creation). Treat as a non-zero exit so
      // the engine can fall back when permitted.
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: msg,
        diff: "",
        changed: false,
        failureReason: looksCommandNotFound(msg) ? "command_not_found" : "non_zero_exit",
        durationMs: Date.now() - started,
      };
    }

    const diff = mutating ? await this.safeDiff(input.cwd) : "";
    const changed = diff.trim().length > 0;
    const combined = `${raw.stdout}\n${raw.stderr}`;

    let failureReason: AutopilotProviderResult["failureReason"];
    if (raw.spawnFailed && looksCommandNotFound(combined)) failureReason = "command_not_found";
    else if (raw.timedOut) failureReason = "timeout";
    else if (raw.code !== 0) failureReason = looksRateLimited(combined) ? "rate_limit" : "non_zero_exit";
    else if (combined.trim().length === 0) failureReason = "empty_output";
    else if (mutating && !changed) failureReason = "no_changes";

    return {
      ok: failureReason === undefined,
      exitCode: raw.code,
      stdout: raw.stdout,
      stderr: raw.stderr,
      diff,
      changed,
      branch: raw.branch,
      failureReason,
      durationMs: Date.now() - started,
    };
  }

  private async safeDiff(cwd: string): Promise<string> {
    try {
      return await this.git.diff(cwd);
    } catch {
      return "";
    }
  }
}

/** Mode-specific framing + constraints + continuation context for the agent. */
function buildPrompt(input: AutopilotProviderInput): string {
  const parts: string[] = [];
  switch (input.mode) {
    case "plan":
      parts.push("You are in PLAN MODE. Do NOT modify files. Produce a concise implementation plan for the task below.");
      break;
    case "review":
      parts.push("You are in REVIEW MODE. Do NOT modify files. Review the code with respect to the task below and report findings, risks, and concrete suggestions.");
      break;
    case "fix":
      parts.push("Diagnose and FIX the issue described below. Make the minimal changes needed, then run the project's tests/validation to confirm the fix.");
      break;
    case "pr":
      parts.push("Implement the task below on the current work branch and prepare the changes for a pull request: ensure tests pass and write a short PR title and description. Do NOT push or open the PR yourself — the human approves that separately.");
      break;
    case "execute":
    default:
      parts.push("Implement the task below. Run tests/validation when done.");
      break;
  }
  if (input.constraints) parts.push(`Constraints:\n${input.constraints}`);
  parts.push(`Task:\n${input.task}`);
  if (input.priorContext) {
    const p = input.priorContext;
    parts.push(
      `Note: a previous automation attempt did not complete (reason: ${p.failureReason}).` +
        (p.stderrSummary ? `\nIts error output:\n${p.stderrSummary}` : ""),
    );
    if (p.diff && p.diff.trim().length > 0) {
      parts.push(
        "The working tree already contains partial changes from that attempt. Continue from the CURRENT state of the repository — do not start over or revert existing changes.",
      );
    }
  }
  return parts.join("\n\n");
}
