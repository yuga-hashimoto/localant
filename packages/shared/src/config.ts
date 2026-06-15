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

/**
 * Reasons an Autopilot provider attempt can fail in a way the fallback policy
 * may act on. `safety_block` and `approval_required` are listed so the policy
 * can explicitly *refuse* to fall back on them (the defaults below do).
 */
export const AUTOPILOT_FALLBACK_REASONS = [
  "timeout",
  "non_zero_exit",
  "empty_output",
  "no_changes",
  "rate_limit",
  "command_not_found",
  // Several agent CLIs (claude, codex, openclaw, …) print an auth/config error
  // and still exit 0, so a failed run is otherwise indistinguishable from a
  // successful one. `auth_error` flags that case so the chain falls back to a
  // working provider instead of returning the error text as the "answer".
  "auth_error",
  "safety_block",
  "approval_required",
] as const;
export type AutopilotFallbackReason = (typeof AUTOPILOT_FALLBACK_REASONS)[number];

export const AUTOPILOT_MODES = ["plan", "execute", "review", "fix", "pr"] as const;
export type AutopilotMode = (typeof AUTOPILOT_MODES)[number];

/** Per-provider toggle in Autopilot Settings. A disabled provider is never
 * selected as primary or fallback, regardless of its CLI availability. */
const AutopilotProviderSetting = z.object({
  enabled: z.boolean().default(true),
});

/**
 * Fallback policy: which failure reasons permit advancing to the next provider.
 * Safety blocks and approval-required gates default to NOT falling back — a
 * provider-agnostic guard rejection means every provider would hit the same
 * wall, and approvals are the human's to grant.
 */
const AutopilotFallbackPolicy = z
  .object({
    onTimeout: z.boolean().default(true),
    onNonZeroExit: z.boolean().default(true),
    onEmptyOutput: z.boolean().default(true),
    onNoChanges: z.boolean().default(true),
    onRateLimit: z.boolean().default(true),
    onCommandNotFound: z.boolean().default(true),
    onAuthError: z.boolean().default(true),
    onSafetyBlock: z.boolean().default(false),
    onApprovalRequired: z.boolean().default(false),
  })
  .prefault({});
export type AutopilotFallbackPolicyT = z.infer<typeof AutopilotFallbackPolicy>;

/**
 * Autopilot Settings. The public `autopilot` tool never names a provider; it
 * reads `primary` + ordered `fallbacks` from here, skips disabled providers,
 * and advances through them per `fallbackPolicy`. Provider ids are
 * `codingAgents` keys (claude-code / codex / opencode / openclaw /
 * antigravity-cli / hermes-agent / command-code).
 */
const AutopilotConfig = z
  .object({
    primary: z.string().default("claude-code"),
    // Ordered fallback chain. Tried top-to-bottom after the primary fails in a
    // way the policy permits. Disabled providers and the primary are skipped.
    fallbacks: z.array(z.string()).default(["codex", "opencode"]),
    providers: z.record(z.string(), AutopilotProviderSetting).default({}),
    fallbackPolicy: AutopilotFallbackPolicy,
  })
  .prefault({});

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
    // prefault (not default): parse this partial through the schema so the
    // other fields' defaults are applied. Zod 4's `.default()` would require a
    // fully-resolved object.
    .prefault({ provider: "tailscale" }),
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
    // prefault: an empty object parsed through the schema yields all defaults.
    .prefault({}),
  assets: z
    .object({
      // Hard ceiling on the size of any single received/imported asset. Larger
      // than security.maxFileSizeBytes because images/media legitimately exceed
      // the text-file limit. Caps both the declared transfer size and the bytes
      // actually downloaded over the network.
      maxAssetBytes: z.number().int().positive().default(26_214_400), // 25 MiB
      // MIME allowlist for imported/received assets. Enforced against the
      // detected magic bytes, not just the declared MIME.
      allowedMimeTypes: z
        .array(z.string())
        .default(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]),
      // Directory scanned by asset_import_latest_download. Defaults to the OS
      // Downloads folder when unset.
      downloadsDir: z.string().optional(),
    })
    .prefault({}),
  codingAgents: z
    .record(z.string(), CodingAgentConfig)
    // prefault: each agent literal omits some defaulted fields, so parse the
    // map through the schema rather than requiring fully-resolved entries.
    .prefault({
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
        // non-interactively (requires provider API keys in the shell). The
        // `agent` subcommand refuses to run without a session selector
        // (--to / --session-id / --agent), so an explicit --session-id is
        // required — the bare form errors with "Pass --to/--session-id/--agent".
        // Plan gets its own session id so its read-only "do not modify"
        // instructions never bleed into execution; execute and resume share one
        // session so resume continues the execute turn.
        planArgs: ["agent", "--local", "--session-id", "localant-plan", "-m"],
        executeArgs: ["agent", "--local", "--session-id", "localant-exec", "-m"],
        resumeArgs: ["agent", "--local", "--session-id", "localant-exec", "-m"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
      "antigravity-cli": {
        enabled: true,
        command: "agy",
        args: [],
        // agy launches an interactive TUI by default, which hangs when spawned
        // without a TTY. --print runs a single prompt non-interactively, but it
        // CONSUMES THE NEXT TOKEN as the prompt value (it is `--print <prompt>`,
        // an alias of --prompt — not a boolean). So the prompt must sit
        // immediately after --print, and every other flag (-c, danger) must come
        // before --print or trail after the prompt. The {{prompt}} placeholder
        // pins it in the right slot regardless of appended dangerArgs.
        planArgs: ["--print", "{{prompt}}"],
        executeArgs: ["--print", "{{prompt}}"],
        // -c/--continue resumes the most recent agy conversation; it must precede
        // --print so it is not swallowed as the prompt value.
        resumeArgs: ["-c", "--print", "{{prompt}}"],
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
        // `-q/--query` REQUIRES its value as the next token (argparse errors if
        // the next token is another option, e.g. --yolo). So the prompt must sit
        // immediately after -q; the {{prompt}} placeholder keeps it there even
        // when dangerArgs (--yolo) are appended in yolo mode.
        planArgs: ["chat", "-q", "{{prompt}}"],
        executeArgs: ["chat", "-q", "{{prompt}}"],
        // --continue resumes the most recent hermes session.
        resumeArgs: ["chat", "--continue", "-q", "{{prompt}}"],
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
      "command-code": {
        enabled: true,
        command: "cmd",
        args: [],
        // Command Code (commandcode.ai) ships the `cmd` binary with Claude
        // Code-compatible flags. `-p/--print <prompt>` runs a single prompt
        // non-interactively and exits; the prompt is the trailing positional.
        planArgs: ["-p"],
        executeArgs: ["-p"],
        // -c/--continue resumes the most recent conversation in the cwd.
        resumeArgs: ["-p", "-c"],
        dangerArgs: ["--dangerously-skip-permissions"],
        defaultPermissionMode: "plan",
        maxTurns: 10,
        timeoutMs: 600_000,
      },
    }),
  autopilot: AutopilotConfig,
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
