import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * `agent_run`: a single entry point to delegate to a local coding agent
 * (claude-code / codex / opencode / openclaw / antigravity-cli / hermes-agent /
 * …). mode=plan produces a plan only; mode=execute creates a work branch and
 * runs the agent. Both are risk 3. The remaining agent_* names are registered as
 * aliases over the existing coding_agent_* tools.
 */
export function registerAgentRunTool(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "agent_run",
    description:
      "Delegate a task to a local coding agent. mode=plan returns a plan only; mode=execute creates a branch and implements it. Risk 3.",
    risk: 3,
    inputSchema: z.object({
      agent: z.string().default("claude-code"),
      cwd: z.string().describe("Absolute path to the working directory / repo to run the agent in."),
      task: z.string(),
      mode: z.enum(["plan", "execute"]).default("plan"),
      createBranch: z.boolean().default(true),
      branchName: z.string().optional(),
    }),
    summarize: (i) => `${i.agent} ${i.mode} on ${i.cwd}`,
    handler: (i, ctx) => {
      if (i.mode === "plan") {
        return gw.agents.plan(i.agent, i.cwd, i.task);
      }
      return gw.agents.startTask(i.agent, i.cwd, i.task, {
        createBranch: i.createBranch,
        branchName: i.branchName,
        sessionId: ctx.sessionId,
      });
    },
  });
}
