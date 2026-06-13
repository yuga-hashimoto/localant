import { z } from "zod";
import type { Gateway } from "../gateway.js";

export function registerCodingAgentTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "coding_agent_list",
    description: "List configured coding agents and whether their CLI is available.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.agents.list(),
  });

  r.register({
    name: "coding_agent_status",
    description: "Get status for one coding agent.",
    risk: 0,
    inputSchema: z.object({ agent: z.string() }),
    handler: (i) => gw.agents.status(i.agent),
  });

  r.register({
    name: "coding_agent_plan",
    description: "Ask a coding agent to produce an implementation PLAN only (no file changes).",
    risk: 3,
    inputSchema: z.object({ agent: z.string().default("claude-code"), cwd: z.string(), task: z.string() }),
    summarize: (i) => `${i.agent} plan for ${i.cwd}`,
    handler: (i) => gw.agents.plan(i.agent, i.cwd, i.task),
  });

  r.register({
    name: "coding_agent_start_task",
    description:
      "Start an EXECUTION task: creates a work branch, then runs the agent to implement the task. Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({
      agent: z.string().default("claude-code"),
      cwd: z.string(),
      task: z.string(),
      branchName: z.string().optional(),
      createBranch: z.boolean().default(true),
    }),
    summarize: (i) => `${i.agent} EXECUTE on ${i.cwd}`,
    handler: (i, ctx) =>
      gw.agents.startTask(i.agent, i.cwd, i.task, {
        createBranch: i.createBranch,
        branchName: i.branchName,
        sessionId: ctx.sessionId,
      }),
  });

  r.register({
    name: "coding_agent_get_task",
    description: "Get task metadata and status.",
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: (i) => gw.agents.getTask(i.taskId),
  });

  r.register({
    name: "coding_agent_get_logs",
    description: "Get captured logs for a task.",
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: (i) => ({ logs: gw.agents.getLogs(i.taskId) }),
  });

  r.register({
    name: "coding_agent_stop_task",
    description: "Stop a running task.",
    risk: 2,
    inputSchema: z.object({ taskId: z.string() }),
    summarize: (i) => `stop task ${i.taskId}`,
    handler: async (i) => gw.agents.stopTask(i.taskId),
  });

  r.register({
    name: "coding_agent_continue_task",
    description:
      "Continue a task with additional instructions, resuming the agent's prior session on the same branch. Use this to hold a turn-based back-and-forth with the agent (read its output, then send a follow-up).",
    risk: 3,
    inputSchema: z.object({ taskId: z.string(), task: z.string() }),
    summarize: (i) => `continue task ${i.taskId}`,
    handler: (i) => gw.agents.continueTask(i.taskId, i.task),
  });

  r.register({
    name: "coding_agent_get_result",
    description: "Get a task result summary (status + diff).",
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: async (i) => {
      const task = gw.agents.getTask(i.taskId);
      let diff = "";
      try {
        diff = await gw.agents.getDiff(i.taskId);
      } catch {
        /* ignore */
      }
      return { task, diff };
    },
  });

  r.register({
    name: "coding_agent_get_diff",
    description: "Get the git diff produced by a task.",
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: async (i) => ({ diff: await gw.agents.getDiff(i.taskId) }),
  });

  r.register({
    name: "coding_agent_run_validation",
    description: "Run a validate/test command in a working directory and return the result.",
    risk: 3,
    inputSchema: z.object({ cwd: z.string(), command: z.string().describe("e.g. 'pnpm validate'") }),
    summarize: (i) => `validate ${i.cwd}`,
    handler: (i) => gw.agents.runValidation(i.cwd, i.command),
  });
}
