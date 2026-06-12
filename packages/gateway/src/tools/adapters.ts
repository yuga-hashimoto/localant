import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
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

  // OpenClaw has no dedicated tool surface: drive it (if installed) as a
  // configured coding agent via the agent_* / coding_agent_* tools, or register
  // it as a downstream MCP server. The previous openclaw_* CLI wrappers were
  // removed to keep the tool surface focused.

  // Desktop Commander has no dedicated adapter: it is a regular downstream MCP
  // server. Register it with mcp_server_register (name: desktop-commander) and
  // drive it through the generic mcp_server_* bridge below.

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
    handler: (i) => {
      // Pre-flight the config so the caller gets an actionable hint instead of a
      // bare connection error for the common unregistered/disabled cases.
      const cfg = gw.config().mcpServers[i.name];
      if (!cfg) {
        const known = Object.keys(gw.config().mcpServers);
        throw new Error(
          `MCP server '${i.name}' is not registered. ` +
            (known.length ? `Registered servers: ${known.join(", ")}. ` : "") +
            "Register one with mcp_server_register.",
        );
      }
      if (!cfg.enabled) {
        throw new Error(
          `MCP server '${i.name}' is registered but disabled. ` +
            "Enable it with mcp_server_register (same name, enabled: true), then retry.",
        );
      }
      return gw.bridge.listTools(i.name);
    },
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
