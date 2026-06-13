import { z } from "zod";
import { defaultAllowedDirectories } from "./paths.js";

/** Default command allowlist — safe, read-mostly developer commands. */
export const DEFAULT_ALLOWED_COMMANDS: string[] = [
  "pwd",
  "ls",
  "cat",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "pnpm test",
  "pnpm build",
  "pnpm lint",
  "pnpm validate",
  "npm test",
  "npm run build",
  "npm run lint",
];

/**
 * Blocked command tokens. Matched against tokenized command words (after
 * splitting on shell metacharacters), so `rm -rf` and `rm   -rf` and
 * `a && rm -rf` are all caught regardless of spacing.
 */
export const BLOCKED_COMMAND_TOKENS: string[] = [
  "sudo",
  "su",
  "mkfs",
  "dd",
  "chown",
  "ssh",
  "scp",
  "rsync",
  "diskutil",
  "format",
  "shutdown",
  "reboot",
  "killall",
  "mkfs.ext4",
  "fdisk",
];

/**
 * Non-negotiable blocked tokens. These remain blocked in EVERY mode (including
 * `open` and `yolo`) and cannot be removed from the blocklist via the dashboard
 * or config — they are always unioned back in on save. These are the commands
 * that can brick the machine or escalate privileges; everything else is the
 * user's choice in a personal-use deployment.
 */
export const CORE_BLOCKED_COMMAND_TOKENS: string[] = [
  "sudo",
  "su",
  "mkfs",
  "mkfs.ext4",
  "dd",
  "fdisk",
  "diskutil",
  "shutdown",
  "reboot",
];

/**
 * Security modes:
 *  - strict: allowlist-based. Only allowed directories/commands; approval gates
 *    per risk level. Recommended for shared / multi-user environments.
 *  - open (default): deny-list based for personal use. No directory/command
 *    allowlist — everything is permitted except the sensitive blocklist and
 *    core blocked tokens. Only risk-4 (destructive/publish) actions need
 *    approval.
 *  - yolo: like open, but no approval gates at all. The blocklist still applies.
 */
export type SecurityMode = "strict" | "open" | "yolo";

const FilesystemPermission = z.object({
  mode: z.enum(["none", "read", "write"]).default("read"),
  allowedDirectories: z.array(z.string()).default([]),
});

const ShellPermission = z.object({
  mode: z.enum(["none", "allowed", "custom"]).default("none"),
  allowedCommands: z.array(z.string()).default([]),
});

const NetworkPermission = z.object({
  mode: z.enum(["none", "allowlist", "all"]).default("none"),
  allowedHosts: z.array(z.string()).default([]),
});

export const SkillPermissionsSchema = z.object({
  filesystem: FilesystemPermission.default({ mode: "read", allowedDirectories: [] }),
  shell: ShellPermission.default({ mode: "none", allowedCommands: [] }),
  network: NetworkPermission.default({ mode: "none", allowedHosts: [] }),
  secrets: z.array(z.string()).default([]),
  browser: z.enum(["none", "read", "control"]).default("none"),
  adb: z.enum(["none", "read", "control"]).default("none"),
  git: z.enum(["none", "read", "write"]).default("none"),
  agent: z.enum(["none", "plan", "execute"]).default("none"),
});
export type SkillPermissions = z.infer<typeof SkillPermissionsSchema>;

const CodingAgentConfig = z.object({
  enabled: z.boolean().default(true),
  command: z.string(),
  args: z.array(z.string()).default([]),
  planArgs: z.array(z.string()).default([]),
  executeArgs: z.array(z.string()).default([]),
  // Args used to resume/continue a prior session (turn-based dialogue). When a
  // task is continued and resumeArgs is non-empty, these replace executeArgs so
  // the agent picks up its previous context. Empty -> continuation starts fresh.
  resumeArgs: z.array(z.string()).default([]),
  // Flags appended only when security.mode is "yolo" to auto-approve tool use.
  // These differ per agent (e.g. claude/agy use --dangerously-skip-permissions),
  // so they are configured here rather than hardcoded.
  dangerArgs: z.array(z.string()).default([]),
  defaultPermissionMode: z.enum(["plan", "execute"]).default("plan"),
  maxTurns: z.number().int().positive().default(10),
  timeoutMs: z.number().int().positive().default(600_000),
});
export type CodingAgentConfig = z.infer<typeof CodingAgentConfig>;

const McpServerConfig = z
  .object({
    transport: z.enum(["stdio", "streamable-http"]).default("stdio"),
    // stdio transport
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    // streamable-http transport
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    bearerTokenSecretName: z.string().optional(),
    enabled: z.boolean().default(false),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.transport === "stdio" && !cfg.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdio transport requires `command`" });
    }
    if (cfg.transport === "streamable-http" && !cfg.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "streamable-http transport requires `url`" });
    }
  });
export type McpServerConfigT = z.infer<typeof McpServerConfig>;

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  gateway: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(8787),
    })
    .default({ host: "127.0.0.1", port: 8787 }),
  dashboard: z
    .object({
      enabled: z.boolean().default(true),
      port: z.number().int().min(1).max(65535).default(8788),
    })
    .default({ enabled: true, port: 8788 }),
  tunnel: z
    .object({
      provider: z.enum(["tailscale", "cloudflared", "ngrok", "localtunnel", "serveo", "none"]).default("tailscale"),
      publicUrl: z.string().optional(),
      token: z.string().optional(),
      domain: z.string().optional(),
      subdomain: z.string().optional(),
      subdomainConfirmed: z.boolean().default(false),
    })
    .default({ provider: "tailscale" }),
  security: z
    .object({
      mode: z.enum(["strict", "open", "yolo"]).default("open"),
      allowedDirectories: z.array(z.string()).default(defaultAllowedDirectories()),
      allowedCommands: z.array(z.string()).default(DEFAULT_ALLOWED_COMMANDS),
      blockedCommandTokens: z.array(z.string()).default(BLOCKED_COMMAND_TOKENS),
      approveRisk1: z.boolean().default(false),
      maxFileSizeBytes: z.number().int().positive().default(5_000_000),
      maxOutputBytes: z.number().int().positive().default(100_000),
      commandTimeoutMs: z.number().int().positive().default(120_000),
      logRetentionDays: z.number().int().positive().default(30),
    })
    .default({}),
  codingAgents: z
    .record(z.string(), CodingAgentConfig)
    .default({
      "claude-code": {
        enabled: true,
        command: "claude",
        args: [],
        // -p/--print runs a single prompt non-interactively. The prompt is the
        // trailing positional, so it is appended after these args.
        planArgs: ["-p"],
        executeArgs: ["-p"],
        // -c/--continue resumes the most recent conversation in the cwd.
        resumeArgs: ["-p", "-c"],
        dangerArgs: ["--dangerously-skip-permissions"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      codex: {
        enabled: true,
        command: "codex",
        args: [],
        // `codex exec <prompt>` is the non-interactive entry point. Bare
        // `codex <prompt>` opens the interactive TUI and fails without a TTY.
        // --skip-git-repo-check lets it run outside a trusted git repo.
        planArgs: ["exec", "--skip-git-repo-check"],
        executeArgs: ["exec", "--skip-git-repo-check"],
        // `codex exec resume --last <prompt>` continues the most recent session.
        resumeArgs: ["exec", "resume", "--last", "--skip-git-repo-check"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      openclaw: {
        enabled: true,
        command: "openclaw",
        args: [],
        // `openclaw agent --local -m <prompt>` runs one embedded agent turn
        // non-interactively (requires provider API keys in the shell). The bare
        // command otherwise treats the prompt as an unknown subcommand.
        planArgs: ["agent", "--local", "-m"],
        executeArgs: ["agent", "--local", "-m"],
        resumeArgs: ["agent", "--local", "-m"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      "antigravity-cli": {
        enabled: true,
        command: "agy",
        args: [],
        // agy launches an interactive TUI by default, which hangs when spawned
        // without a TTY. --print runs a single prompt non-interactively.
        planArgs: ["--print"],
        executeArgs: ["--print"],
        // -c/--continue resumes the most recent agy conversation.
        resumeArgs: ["--print", "-c"],
        dangerArgs: ["--dangerously-skip-permissions"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      "hermes-agent": {
        enabled: true,
        command: "hermes",
        args: [],
        // `hermes chat -q <prompt>` is the single-query non-interactive mode.
        // The bare prompt was previously passed as a subcommand and rejected.
        planArgs: ["chat", "-q"],
        executeArgs: ["chat", "-q"],
        // --continue resumes the most recent hermes session.
        resumeArgs: ["chat", "--continue", "-q"],
        dangerArgs: ["--yolo"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      opencode: {
        enabled: true,
        command: "opencode",
        args: [],
        // `opencode run <prompt>` runs non-interactively.
        planArgs: ["run"],
        executeArgs: ["run"],
        resumeArgs: ["run", "--continue"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
    }),
  tools: z
    .object({
      // Exposure profile for the MCP surface. `minimal` advertises only the
      // small core (Shell / coding Agent / Skill pillars + read-only fs/project
      // + control plane); `full` advertises every registered tool. See
      // tool-profiles.ts. Defaults to `minimal` to keep tool-selection sharp.
      profile: z.enum(["minimal", "coding", "full"]).default("minimal"),
    })
    .default({ profile: "minimal" }),
  mcpServers: z.record(z.string(), McpServerConfig).default({}),
  skillRegistry: z
    .object({
      sources: z.array(z.string()).default([]),
    })
    .default({ sources: [] }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}
