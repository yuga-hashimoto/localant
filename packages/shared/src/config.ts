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
  enabled: z.boolean().default(false),
  command: z.string(),
  args: z.array(z.string()).default([]),
  planArgs: z.array(z.string()).default([]),
  executeArgs: z.array(z.string()).default([]),
  defaultPermissionMode: z.enum(["plan", "execute"]).default("plan"),
  maxTurns: z.number().int().positive().default(10),
  timeoutMs: z.number().int().positive().default(600_000),
});
export type CodingAgentConfig = z.infer<typeof CodingAgentConfig>;

const McpServerConfig = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  transport: z.enum(["stdio"]).default("stdio"),
  enabled: z.boolean().default(false),
});

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
      provider: z.enum(["cloudflared", "ngrok", "none"]).default("cloudflared"),
      publicUrl: z.string().optional(),
    })
    .default({ provider: "cloudflared" }),
  security: z
    .object({
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
        enabled: false,
        command: "claude",
        args: [],
        planArgs: ["-p"],
        executeArgs: ["-p"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      codex: {
        enabled: false,
        command: "codex",
        args: [],
        planArgs: [],
        executeArgs: [],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
    }),
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
