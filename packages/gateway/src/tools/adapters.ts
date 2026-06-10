import { z } from "zod";
import { commandExists, execFileSafe } from "../util/exec.js";
import type { Gateway } from "../gateway.js";

/**
 * Adapters bridge external systems (OpenClaw, Desktop Commander) and arbitrary
 * MCP servers. They never expose external tools to ChatGPT unmediated — every
 * call flows back through the gateway's permission + approval + audit pipeline.
 */
export function registerAdapterTools(gw: Gateway): void {
  const r = gw.registry;

  // ---------- OpenClaw ----------
  const openclawHint =
    "OpenClaw was not detected. Install it and ensure the `openclaw` CLI is on PATH, then retry.";

  r.register({
    name: "openclaw_status",
    description: "Check whether OpenClaw is installed and reachable.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      const available = await commandExists("openclaw");
      return { available, hint: available ? undefined : openclawHint };
    },
  });
  r.register({
    name: "openclaw_list_skills",
    description: "List OpenClaw skills (via the openclaw CLI).",
    risk: 1,
    inputSchema: z.object({}).strip(),
    handler: async () => requireCli("openclaw", ["skills", "list"], openclawHint),
  });
  r.register({
    name: "openclaw_list_sessions",
    description: "List OpenClaw sessions.",
    risk: 1,
    inputSchema: z.object({}).strip(),
    handler: async () => requireCli("openclaw", ["sessions", "list"], openclawHint),
  });
  r.register({
    name: "openclaw_get_session_history",
    description: "Get an OpenClaw session history.",
    risk: 1,
    inputSchema: z.object({ sessionId: z.string() }),
    handler: async (i) => requireCli("openclaw", ["sessions", "show", i.sessionId], openclawHint),
  });
  r.register({
    name: "openclaw_list_nodes",
    description: "List OpenClaw nodes.",
    risk: 1,
    inputSchema: z.object({}).strip(),
    handler: async () => requireCli("openclaw", ["nodes", "list"], openclawHint),
  });
  r.register({
    name: "openclaw_run_skill",
    description: "Run an OpenClaw skill. Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({ skill: z.string(), args: z.array(z.string()).default([]) }),
    summarize: (i) => `openclaw run ${i.skill}`,
    handler: async (i) => requireCli("openclaw", ["skills", "run", i.skill, ...i.args], openclawHint),
  });
  r.register({
    name: "openclaw_send_session",
    description: "Send a message to an OpenClaw session. Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({ sessionId: z.string(), message: z.string() }),
    summarize: (i) => `openclaw send -> ${i.sessionId}`,
    handler: async (i) => requireCli("openclaw", ["sessions", "send", i.sessionId, i.message], openclawHint),
  });
  r.register({
    name: "openclaw_node_command",
    description: "Run a command on an OpenClaw node. Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({ node: z.string(), command: z.string() }),
    summarize: (i) => `openclaw node ${i.node}`,
    handler: async (i) => requireCli("openclaw", ["nodes", "exec", i.node, i.command], openclawHint),
  });

  // ---------- Desktop Commander ----------
  r.register({
    name: "desktop_commander_status",
    description: "Check whether the Desktop Commander MCP server is configured.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const configured = Boolean(gw.config().mcpServers["desktop-commander"]);
      return { configured, hint: configured ? undefined : "Register it with mcp_server_register (name: desktop-commander)." };
    },
  });
  r.register({
    name: "desktop_commander_list_tools",
    description: "List tools exposed by a registered Desktop Commander MCP server.",
    risk: 1,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const s = gw.config().mcpServers["desktop-commander"];
      if (!s) throw new Error("desktop-commander not registered. Use mcp_server_register.");
      return { note: "Tool discovery flows through the MCP bridge (mcp_server_list_tools)." };
    },
  });
  r.register({
    name: "desktop_commander_run_tool",
    description: "Run a Desktop Commander tool through the gated MCP bridge. Risk 3.",
    risk: 3,
    inputSchema: z.object({ tool: z.string(), input: z.unknown().default({}) }),
    summarize: (i) => `desktop-commander ${i.tool}`,
    handler: (i) => gw.bridge.callTool("desktop-commander", i.tool, (i.input as Record<string, unknown>) ?? {}),
  });

  // ---------- Existing MCP server bridge ----------
  r.register({
    name: "mcp_server_list",
    description: "List registered downstream MCP servers.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ servers: gw.config().mcpServers }),
  });
  r.register({
    name: "mcp_server_register",
    description: "Register a downstream MCP server (stdio) to bridge through the gateway.",
    risk: 2,
    inputSchema: z.object({
      name: z.string(),
      command: z.string(),
      args: z.array(z.string()).default([]),
      enabled: z.boolean().default(false),
    }),
    summarize: (i) => `register mcp server ${i.name}`,
    handler: (i) => {
      const cfg = gw.config();
      const next = { ...cfg, mcpServers: { ...cfg.mcpServers, [i.name]: { command: i.command, args: i.args, transport: "stdio" as const, enabled: i.enabled } } };
      gw.saveConfig(next);
      return { registered: i.name, enabled: i.enabled };
    },
  });
  r.register({
    name: "mcp_server_unregister",
    description: "Remove a registered downstream MCP server.",
    risk: 2,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => {
      const cfg = gw.config();
      const servers = { ...cfg.mcpServers };
      delete servers[i.name];
      gw.saveConfig({ ...cfg, mcpServers: servers });
      return { removed: i.name };
    },
  });
  r.register({
    name: "mcp_server_status",
    description: "Show status for a registered downstream MCP server.",
    risk: 0,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => {
      const s = gw.config().mcpServers[i.name];
      return s ? { name: i.name, ...s } : { error: "not found" };
    },
  });
  r.register({
    name: "mcp_server_list_tools",
    description: "List tools of a downstream MCP server (connects lazily).",
    risk: 1,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => gw.bridge.listTools(i.name),
  });
  r.register({
    name: "mcp_server_run_tool",
    description: "Invoke a tool on a downstream MCP server through the gateway. Risk 3.",
    risk: 3,
    inputSchema: z.object({ name: z.string(), tool: z.string(), input: z.unknown().default({}) }),
    summarize: (i) => `${i.name}.${i.tool}`,
    handler: (i) => gw.bridge.callTool(i.name, i.tool, (i.input as Record<string, unknown>) ?? {}),
  });
}

async function requireCli(cmd: string, args: string[], hint: string): Promise<{ output: string }> {
  if (!(await commandExists(cmd))) throw new Error(hint);
  const res = await execFileSafe(cmd, args, { timeoutMs: 60_000, maxOutputBytes: 100_000 });
  if (res.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  return { output: res.stdout };
}
