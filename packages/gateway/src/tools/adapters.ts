import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { commandExists, execFileSafe } from "../util/exec.js";
import type { Gateway } from "../gateway.js";

const fsReadFileSync = (file: string): string => fs.readFileSync(file, "utf8");
const joinHome = (rel: string): string => path.join(os.homedir(), rel);
const joinCwd = (rel: string): string => path.join(process.cwd(), rel);

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
    description: "Register a downstream MCP server (stdio or streamable-http) to bridge through the gateway.",
    risk: 2,
    inputSchema: z
      .object({
        name: z.string(),
        transport: z.enum(["stdio", "streamable-http"]).default("stdio"),
        command: z.string().optional(),
        args: z.array(z.string()).default([]),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        bearerTokenSecretName: z.string().optional(),
        enabled: z.boolean().default(false),
      })
      .superRefine((v, ctx) => {
        if (v.transport === "stdio" && !v.command)
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdio requires command" });
        if (v.transport === "streamable-http" && !v.url)
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "streamable-http requires url" });
      }),
    summarize: (i) => `register mcp server ${i.name} (${i.transport})`,
    handler: (i) => {
      const cfg = gw.config();
      const entry =
        i.transport === "stdio"
          ? { transport: "stdio" as const, command: i.command, args: i.args, enabled: i.enabled }
          : {
              transport: "streamable-http" as const,
              url: i.url,
              args: [],
              headers: i.headers,
              bearerTokenSecretName: i.bearerTokenSecretName,
              enabled: i.enabled,
            };
      gw.saveConfig({ ...cfg, mcpServers: { ...cfg.mcpServers, [i.name]: entry } });
      return { registered: i.name, transport: i.transport, enabled: i.enabled };
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

  // ---------- MCP config imports (all imported servers start DISABLED) ----------
  const importServers = (servers: Record<string, ImportedServer>): { imported: string[] } => {
    const cfg = gw.config();
    const next = { ...cfg.mcpServers };
    const imported: string[] = [];
    for (const [name, s] of Object.entries(servers)) {
      if (next[name]) continue; // never override an existing (possibly enabled) server
      next[name] = { ...s, args: s.args ?? [], enabled: false };
      imported.push(name);
    }
    if (imported.length) gw.saveConfig({ ...cfg, mcpServers: next });
    return { imported };
  };

  r.register({
    name: "mcp_import_claude_config",
    description: "Import MCP servers from Claude Code config (.mcp.json / ~/.claude.json). Imported servers start disabled.",
    risk: 2,
    inputSchema: z.object({ path: z.string().optional() }),
    summarize: () => "import claude mcp config",
    handler: (i) => importServers(readClaudeServers(i.path)),
  });
  r.register({
    name: "mcp_import_codex_config",
    description: "Import MCP servers from Codex config (~/.codex/config.toml / .codex/config.toml). Imported servers start disabled.",
    risk: 2,
    inputSchema: z.object({ path: z.string().optional() }),
    summarize: () => "import codex mcp config",
    handler: (i) => importServers(readCodexServers(i.path)),
  });
  r.register({
    name: "mcp_import_opencode_config",
    description: "Import MCP servers from OpenCode config (opencode.json / opencode.jsonc). Imported servers start disabled.",
    risk: 2,
    inputSchema: z.object({ path: z.string().optional() }),
    summarize: () => "import opencode mcp config",
    handler: (i) => importServers(readOpencodeServers(i.path)),
  });
  r.register({
    name: "mcp_import_all_agent_configs",
    description: "Import MCP servers from Claude Code, Codex, and OpenCode configs. Imported servers start disabled.",
    risk: 2,
    inputSchema: z.object({}).strip(),
    summarize: () => "import all agent mcp configs",
    handler: () =>
      importServers({ ...readClaudeServers(), ...readCodexServers(), ...readOpencodeServers() }),
  });
}

interface ImportedServer {
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

/** Safely read + parse a JSON file, returning {} on any error. */
function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fsReadFileSync(file)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeServers(obj: unknown): Record<string, ImportedServer> {
  const out: Record<string, ImportedServer> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [name, raw] of Object.entries(obj as Record<string, Record<string, unknown>>)) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.url === "string") {
      out[name] = { transport: "streamable-http", url: raw.url, headers: raw.headers as Record<string, string> | undefined };
    } else if (typeof raw.command === "string") {
      out[name] = { transport: "stdio", command: raw.command, args: (raw.args as string[]) ?? [] };
    }
  }
  return out;
}

function readClaudeServers(explicit?: string): Record<string, ImportedServer> {
  const candidates = explicit ? [explicit] : [joinCwd(".mcp.json"), joinHome(".claude.json")];
  const merged: Record<string, ImportedServer> = {};
  for (const file of candidates) {
    const json = readJson(file);
    Object.assign(merged, normalizeServers(json.mcpServers));
  }
  return merged;
}

function readCodexServers(explicit?: string): Record<string, ImportedServer> {
  const candidates = explicit ? [explicit] : [joinHome(".codex/config.toml"), joinCwd(".codex/config.toml")];
  const merged: Record<string, ImportedServer> = {};
  for (const file of candidates) {
    let text = "";
    try {
      text = fsReadFileSync(file);
    } catch {
      continue;
    }
    Object.assign(merged, parseCodexToml(text));
  }
  return merged;
}

function readOpencodeServers(explicit?: string): Record<string, ImportedServer> {
  const candidates = explicit ? [explicit] : [joinCwd("opencode.json"), joinCwd("opencode.jsonc")];
  const merged: Record<string, ImportedServer> = {};
  for (const file of candidates) {
    let text = "";
    try {
      text = fsReadFileSync(file);
    } catch {
      continue;
    }
    try {
      const json = JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
      // OpenCode uses `mcp` keyed by name with { type, command/url }.
      const mcp = (json.mcp ?? json.mcpServers) as Record<string, Record<string, unknown>> | undefined;
      if (mcp) {
        for (const [name, raw] of Object.entries(mcp)) {
          if (typeof raw.url === "string") merged[name] = { transport: "streamable-http", url: raw.url };
          else if (Array.isArray(raw.command))
            merged[name] = { transport: "stdio", command: raw.command[0] as string, args: (raw.command as string[]).slice(1) };
          else if (typeof raw.command === "string")
            merged[name] = { transport: "stdio", command: raw.command, args: (raw.args as string[]) ?? [] };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return merged;
}

/** Minimal TOML reader for Codex `[mcp_servers.<name>]` blocks. */
function parseCodexToml(text: string): Record<string, ImportedServer> {
  const out: Record<string, ImportedServer> = {};
  let current: string | undefined;
  for (const line of text.split("\n")) {
    const header = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/.exec(line);
    if (header && header[1]) {
      current = header[1].replace(/["']/g, "");
      out[current] = { transport: "stdio", args: [] };
      continue;
    }
    if (!current) continue;
    const entry = out[current];
    if (!entry) continue;
    const cmd = /^\s*command\s*=\s*"([^"]+)"/.exec(line);
    if (cmd) entry.command = cmd[1];
    const url = /^\s*url\s*=\s*"([^"]+)"/.exec(line);
    if (url) {
      entry.url = url[1];
      entry.transport = "streamable-http";
    }
    const args = /^\s*args\s*=\s*\[(.*)\]/.exec(line);
    if (args && args[1] !== undefined)
      entry.args = args[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  }
  // Drop entries with neither command nor url.
  for (const [k, v] of Object.entries(out)) if (!v.command && !v.url) delete out[k];
  return out;
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function requireCli(cmd: string, args: string[], hint: string): Promise<{ output: string }> {
  if (!(await commandExists(cmd))) throw new Error(hint);
  const res = await execFileSafe(cmd, args, { timeoutMs: 60_000, maxOutputBytes: 100_000 });
  if (res.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  return { output: res.stdout };
}
