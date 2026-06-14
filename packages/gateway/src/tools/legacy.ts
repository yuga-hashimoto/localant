import { z } from "zod";
import type { Gateway } from "../gateway.js";
import { commandExists, execFileSafe } from "../util/exec.js";

const DEPRECATED = "Deprecated compatibility wrapper for stale ChatGPT tool schemas. Prefer the high-level autopilot tool or generic MCP bridge.";

const commandOut = (r: { code: number | null; stdout: string; stderr: string; timedOut: boolean }) => ({
  code: r.code,
  stdout: r.stdout,
  stderr: r.stderr,
  timedOut: r.timedOut,
});

async function openclaw(args: string[], timeoutMs = 120_000): Promise<unknown> {
  if (!(await commandExists("openclaw"))) return { available: false, error: "openclaw not found on PATH" };
  const res = await execFileSafe("openclaw", args, { timeoutMs, maxOutputBytes: 200_000 });
  return commandOut(res);
}

function desktopCommanderName(gw: Gateway): string | undefined {
  const servers = gw.config().mcpServers;
  if (servers["desktop-commander"]) return "desktop-commander";
  if (servers.desktop_commander) return "desktop_commander";
  return undefined;
}

/**
 * Compatibility wrappers for tools that older ChatGPT MCP schemas may still try
 * to call after LocalAnt has slimmed its advertised surface. These wrappers keep
 * stale conversations from failing with "Unknown tool" while steering new flows
 * toward `autopilot` and `mcp_server_*`.
 */
export function registerLegacyCompatibilityTools(gw: Gateway): void {
  const r = gw.registry;

  // -------------------------------------------------------------------------
  // Retired public coding-agent tools. Kept as thin wrappers over the internal
  // CodingAgentManager for schema-cache compatibility only.
  // -------------------------------------------------------------------------
  r.register({
    name: "coding_agent_list",
    description: `${DEPRECATED} List configured coding agents and whether their CLI is available.`,
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.agents.list(),
  });
  r.register({
    name: "coding_agent_status",
    description: `${DEPRECATED} Get status for one coding agent.`,
    risk: 0,
    inputSchema: z.object({ agent: z.string() }),
    handler: (i) => gw.agents.status(i.agent),
  });
  r.register({
    name: "coding_agent_plan",
    description: `${DEPRECATED} Ask a coding agent to produce an implementation PLAN only.`,
    risk: 3,
    inputSchema: z.object({ agent: z.string().default("claude-code"), cwd: z.string(), task: z.string() }),
    summarize: (i) => `legacy coding_agent_plan ${i.agent} in ${i.cwd}`,
    handler: (i) => gw.agents.plan(i.agent, i.cwd, i.task),
  });
  r.register({
    name: "coding_agent_start_task",
    description: `${DEPRECATED} Start an execution task with a coding agent.`,
    risk: 3,
    inputSchema: z.object({
      agent: z.string().default("claude-code"),
      cwd: z.string(),
      task: z.string(),
      branchName: z.string().optional(),
      createBranch: z.boolean().default(true),
    }),
    summarize: (i) => `legacy coding_agent_start_task ${i.agent} in ${i.cwd}`,
    handler: (i, ctx) => gw.agents.startTask(i.agent, i.cwd, i.task, {
      branchName: i.branchName,
      createBranch: i.createBranch,
      sessionId: ctx.sessionId,
    }),
  });
  r.register({
    name: "coding_agent_continue_task",
    description: `${DEPRECATED} Continue a task with additional instructions on the same branch.`,
    risk: 3,
    inputSchema: z.object({ taskId: z.string(), task: z.string() }),
    summarize: (i) => `legacy coding_agent_continue_task ${i.taskId}`,
    handler: (i) => gw.agents.continueTask(i.taskId, i.task),
  });
  r.register({
    name: "coding_agent_get_task",
    description: `${DEPRECATED} Get task metadata and status.`,
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: (i) => gw.agents.getTask(i.taskId),
  });
  r.register({
    name: "coding_agent_get_logs",
    description: `${DEPRECATED} Get captured logs for a task.`,
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: (i) => ({ logs: gw.agents.getLogs(i.taskId) }),
  });
  r.register({
    name: "coding_agent_get_diff",
    description: `${DEPRECATED} Get the git diff produced by a task.`,
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: async (i) => ({ diff: await gw.agents.getDiff(i.taskId) }),
  });
  r.register({
    name: "coding_agent_get_result",
    description: `${DEPRECATED} Get a task result summary including current diff.`,
    risk: 0,
    inputSchema: z.object({ taskId: z.string() }),
    handler: async (i) => ({ task: gw.agents.getTask(i.taskId), diff: await gw.agents.getDiff(i.taskId) }),
  });
  r.register({
    name: "coding_agent_stop_task",
    description: `${DEPRECATED} Stop a running task.`,
    risk: 2,
    inputSchema: z.object({ taskId: z.string() }),
    handler: (i) => gw.agents.stopTask(i.taskId),
  });
  r.register({
    name: "coding_agent_run_validation",
    description: `${DEPRECATED} Run a validate/test command in a working directory.`,
    risk: 3,
    inputSchema: z.object({ cwd: z.string(), command: z.string() }),
    summarize: (i) => `legacy coding_agent_run_validation ${i.command}`,
    handler: (i) => gw.agents.runValidation(i.cwd, i.command),
  });

  const alias = (name: string, target: string, risk?: 0 | 1 | 2 | 3 | 4): void => {
    const def = r.get(target);
    if (!def) throw new Error(`legacy alias '${name}' -> unknown target '${target}'`);
    r.register({
      name,
      description: `${DEPRECATED} Alias of ${target}.`,
      risk: risk ?? def.risk,
      inputSchema: def.inputSchema,
      summarize: def.summarize,
      auditInput: def.auditInput,
      handler: def.handler,
    });
  };

  alias("agent_list", "coding_agent_list");
  alias("agent_status", "coding_agent_status");
  alias("agent_plan", "coding_agent_plan");
  alias("agent_continue", "coding_agent_continue_task");
  alias("agent_get_diff", "coding_agent_get_diff");
  alias("agent_get_logs", "coding_agent_get_logs");
  alias("agent_get_result", "coding_agent_get_result");
  alias("agent_run_validation", "coding_agent_run_validation");
  alias("agent_stop", "coding_agent_stop_task");
  r.register({
    name: "agent_run",
    description: `${DEPRECATED} Delegate to a local coding agent. mode=plan returns a plan; mode=execute starts an execution task.`,
    risk: 3,
    inputSchema: z.object({
      agent: z.string().default("claude-code"),
      cwd: z.string(),
      task: z.string(),
      mode: z.enum(["plan", "execute"]).default("plan"),
      createBranch: z.boolean().default(true),
      branchName: z.string().optional(),
    }),
    summarize: (i) => `legacy agent_run ${i.mode} ${i.agent} in ${i.cwd}`,
    handler: (i, ctx) =>
      i.mode === "execute"
        ? gw.agents.startTask(i.agent, i.cwd, i.task, {
            createBranch: i.createBranch,
            branchName: i.branchName,
            sessionId: ctx.sessionId,
          })
        : gw.agents.plan(i.agent, i.cwd, i.task),
  });

  // -------------------------------------------------------------------------
  // Retired LocalAnt Autopilot aliases from an intermediate schema.
  // -------------------------------------------------------------------------
  alias("localant_autopilot_get_logs", "coding_agent_get_logs");
  alias("localant_autopilot_get_diff", "coding_agent_get_diff");
  alias("localant_autopilot_continue", "coding_agent_continue_task");
  alias("localant_autopilot_stop", "coding_agent_stop_task");
  alias("localant_autopilot_run_validation", "coding_agent_run_validation");
  r.register({
    name: "localant_autopilot_status",
    description: `${DEPRECATED} Get one legacy task status.`,
    risk: 0,
    inputSchema: z.object({ taskId: z.string().optional() }),
    handler: (i) => (i.taskId ? gw.agents.getTask(i.taskId) : { tasks: gw.agents.listTasks() }),
  });

  // -------------------------------------------------------------------------
  // Retired OpenClaw CLI wrappers. Best-effort compatibility only; new usage
  // should configure OpenClaw as an Autopilot provider or downstream MCP server.
  // -------------------------------------------------------------------------
  r.register({
    name: "openclaw_status",
    description: `${DEPRECATED} Check whether OpenClaw is installed and reachable.`,
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => ({ available: await commandExists("openclaw") }),
  });
  r.register({ name: "openclaw_list_skills", description: `${DEPRECATED} List OpenClaw skills.`, risk: 1, inputSchema: z.object({}).strip(), handler: () => openclaw(["skills", "list"]) });
  r.register({ name: "openclaw_list_nodes", description: `${DEPRECATED} List OpenClaw nodes.`, risk: 1, inputSchema: z.object({}).strip(), handler: () => openclaw(["nodes", "list"]) });
  r.register({ name: "openclaw_list_sessions", description: `${DEPRECATED} List OpenClaw sessions.`, risk: 1, inputSchema: z.object({}).strip(), handler: () => openclaw(["sessions", "list"]) });
  r.register({ name: "openclaw_get_session_history", description: `${DEPRECATED} Get OpenClaw session history.`, risk: 1, inputSchema: z.object({ sessionId: z.string() }), handler: (i) => openclaw(["sessions", "history", i.sessionId]) });
  r.register({ name: "openclaw_run_skill", description: `${DEPRECATED} Run an OpenClaw skill.`, risk: 3, inputSchema: z.object({ skill: z.string(), args: z.array(z.string()).default([]) }), summarize: (i) => `legacy openclaw skill ${i.skill}`, handler: (i) => openclaw(["skills", "run", i.skill, ...i.args], 300_000) });
  r.register({ name: "openclaw_node_command", description: `${DEPRECATED} Run a command on an OpenClaw node.`, risk: 3, inputSchema: z.object({ node: z.string(), command: z.string() }), summarize: (i) => `legacy openclaw node ${i.node}`, handler: (i) => openclaw(["nodes", "command", i.node, i.command], 300_000) });
  r.register({ name: "openclaw_send_session", description: `${DEPRECATED} Send a message to an OpenClaw session.`, risk: 3, inputSchema: z.object({ sessionId: z.string(), message: z.string() }), summarize: (i) => `legacy openclaw session ${i.sessionId}`, handler: (i) => openclaw(["sessions", "send", i.sessionId, i.message], 300_000) });

  // -------------------------------------------------------------------------
  // Retired Desktop Commander wrappers. New usage should register it as a
  // downstream MCP server and call mcp_server_* directly.
  // -------------------------------------------------------------------------
  r.register({
    name: "desktop_commander_status",
    description: `${DEPRECATED} Check whether Desktop Commander MCP server is configured.`,
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const name = desktopCommanderName(gw);
      return { configured: Boolean(name), name };
    },
  });
  r.register({
    name: "desktop_commander_list_tools",
    description: `${DEPRECATED} List Desktop Commander tools through the MCP bridge.`,
    risk: 1,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const name = desktopCommanderName(gw);
      if (!name) throw new Error("Desktop Commander is not registered. Register it with mcp_server_register first.");
      return gw.bridge.listTools(name);
    },
  });
  r.register({
    name: "desktop_commander_run_tool",
    description: `${DEPRECATED} Run a Desktop Commander tool through the MCP bridge.`,
    risk: 3,
    inputSchema: z.object({ tool: z.string(), input: z.unknown().default({}) }),
    summarize: (i) => `legacy desktop commander ${i.tool}`,
    handler: (i) => {
      const name = desktopCommanderName(gw);
      if (!name) throw new Error("Desktop Commander is not registered. Register it with mcp_server_register first.");
      return gw.bridge.callTool(name, i.tool, (i.input as Record<string, unknown>) ?? {});
    },
  });
}
