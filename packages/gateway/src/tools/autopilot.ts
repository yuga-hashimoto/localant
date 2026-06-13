import { z } from "zod";
import { AUTOPILOT_MODES } from "@localant/shared";
import type { Gateway } from "../gateway.js";
import type { AutopilotRunResult } from "../autopilot/engine.js";

const MUTATING_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * High-level task text that Autopilot refuses to delegate. Defence-in-depth on
 * top of PathGuard / CommandGuard / the approval queue: it keeps an obviously
 * dangerous delegation (publish/deploy, force pushes, secret material, recursive
 * removal) from being kicked off through the high-level surface without a
 * dedicated tool and explicit user approval.
 */
const DENIED_TERMS = [
  "publish",
  "deploy",
  "release",
  "git push",
  "git reset --hard",
  ".env",
  "id_rsa",
  "id_ed25519",
  ".npmrc",
  "token",
  "secret",
  "credential",
  "keychain",
  "rm -rf",
  "rm -fr",
  "rm -r",
  "rm -f",
];

function assertAutopilotTextAllowed(value: string, field: string): void {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (DENIED_TERMS.some((term) => normalized.includes(term))) {
    throw new Error(
      `Autopilot refused ${field}: this operation requires a dedicated tool and explicit user approval.`,
    );
  }
}

/**
 * Shape the engine result for ChatGPT. Deliberately omits provider identity
 * (`providerId` / `providerLabel`): the automation backend is never named on
 * the ChatGPT-facing surface — only in the Web UI and localant_doctor. The full
 * provider-attributed record still goes to the audit log.
 */
function publicResult(r: AutopilotRunResult): Record<string, unknown> {
  return {
    ok: r.ok,
    mode: r.mode,
    cwd: r.cwd,
    branch: r.branch,
    changed: r.changed,
    diff: r.diff,
    output: r.output,
    status: r.ok
      ? "completed"
      : r.stoppedReason
        ? `stopped: ${r.stoppedReason}`
        : r.exhausted
          ? "all automation attempts failed"
          : "failed",
    attempts: r.attempts.length,
  };
}

export function registerAutopilotTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "autopilot",
    description:
      "Delegate a natural-language local task to LocalAnt's automation system. It plans, implements, reviews, or fixes code in a working directory using your configured automation, on a fresh work branch, behind LocalAnt's safety gates and approvals. " +
      "modes: plan (no changes), execute (implement), review (read-only assessment), fix (diagnose + repair + validate), pr (implement and prepare a PR — it does NOT push or open the PR). " +
      "Does not push, publish, deploy, or open PRs — those stay behind explicit approval. Risk 3.",
    risk: 3,
    annotations: MUTATING_ANNOTATIONS,
    inputSchema: z.object({
      task: z.string().describe("What you want done, in plain language."),
      cwd: z.string().describe("Absolute path to the working directory / repo. Must be inside an allowed directory."),
      mode: z.enum(AUTOPILOT_MODES).default("plan"),
      constraints: z.string().optional().describe("Optional constraints: scope, style, files to avoid, etc."),
      timeoutMs: z.number().int().positive().max(1_800_000).optional(),
    }),
    summarize: (i) => `autopilot ${i.mode} on ${i.cwd}`,
    handler: async (i, ctx) => {
      assertAutopilotTextAllowed(i.task, "task");
      if (i.constraints) assertAutopilotTextAllowed(i.constraints, "constraints");
      const result = await gw.autopilot.run({
        task: i.task,
        cwd: i.cwd,
        mode: i.mode,
        constraints: i.constraints,
        timeoutMs: i.timeoutMs,
        sessionId: ctx.sessionId,
      });
      return publicResult(result);
    },
  });
}
