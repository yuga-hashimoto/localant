import os from "node:os";
import {
  APP_VERSION,
  approvalFor,
  redactDeep,
  createLogger,
  RISK_LABELS,
  CORE_BLOCKED_COMMAND_TOKENS,
  isToolInProfile,
  type ApprovalRequirement,
  type Config,
  type AppPaths,
  type RiskLevel,
  type SecurityMode,
} from "@localant/shared";
import { ConfigStore } from "./stores/config-store.js";
import { SecretVault } from "./stores/secret-vault.js";
import { AuditLog } from "./stores/audit-log.js";
import { ApprovalStore } from "./stores/approval-store.js";
import { PathGuard } from "./security/path-guard.js";
import { CommandGuard } from "./security/command-guard.js";
import { LspService } from "./managers/lsp-service.js";
import { FsManager } from "./managers/fs-manager.js";
import { GitManager } from "./managers/git-manager.js";
import { ShellManager } from "./managers/shell-manager.js";
import { SkillRuntime } from "./managers/skill-runtime.js";
import { CodingAgentManager } from "./managers/coding-agent-manager.js";
import { AssetManager } from "./managers/asset-manager.js";
import { TunnelManager } from "./managers/tunnel-manager.js";
import { McpBridge } from "./managers/mcp-bridge.js";
import { ProviderRegistry } from "./autopilot/provider-registry.js";
import { AutopilotEngine } from "./autopilot/engine.js";
import { ToolRegistry, type ToolCallContext } from "./registry.js";

const log = createLogger("gateway");

export class ApprovalRequiredError extends Error {
  constructor(
    message: string,
    public readonly approvalId: string,
    public readonly requirement: "single" | "double",
  ) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

/** Result envelope returned to MCP for every tool call. */
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  approvalRequired?: { approvalId: string; risk: number; requirement: string; message: string };
  error?: string;
}

/** Central object wiring stores, guards, managers and the tool registry. */
export class Gateway {
  readonly configStore: ConfigStore;
  readonly paths: AppPaths;
  readonly vault: SecretVault;
  readonly audit: AuditLog;
  readonly approvals: ApprovalStore;
  readonly pathGuard: PathGuard;
  readonly commandGuard: CommandGuard;
  readonly fs: FsManager;
  readonly assetBridge: AssetManager;
  readonly git: GitManager;
  readonly lsp: LspService;
  readonly shell: ShellManager;
  readonly skills: SkillRuntime;
  readonly agents: CodingAgentManager;
  readonly providers: ProviderRegistry;
  readonly autopilot: AutopilotEngine;
  readonly tunnel: TunnelManager;
  readonly bridge: McpBridge;
  readonly registry = new ToolRegistry();

  private cfg: Config;
  readonly startedAt = new Date().toISOString();

  /** Ports the servers actually bound to (may differ from config if the
   * preferred port was busy and we fell back to a free one). */
  private boundGatewayPort?: number;
  private boundDashboardPort?: number;

  setBoundPorts(gatewayPort: number, dashboardPort?: number): void {
    this.boundGatewayPort = gatewayPort;
    this.boundDashboardPort = dashboardPort;
  }

  /** The gateway port in effect right now (bound port if started, else config). */
  gatewayPort(): number {
    return this.boundGatewayPort ?? this.cfg.gateway.port;
  }

  constructor(base?: string) {
    this.configStore = new ConfigStore(base);
    this.configStore.ensureInitialized();
    this.paths = this.configStore.paths;
    this.cfg = this.configStore.load();
    const token = this.configStore.getToken();

    // Encrypt secrets with a dedicated key (independent of the auth token), but
    // pass the current token as the legacy key so secrets written by older
    // versions are still readable and can be migrated forward.
    this.vault = new SecretVault(this.paths, this.configStore.getVaultKey(), token);
    this.vault.migrate();
    this.audit = new AuditLog(this.paths);
    this.audit.setSecretsProvider(() => this.vault.allValues());
    // Prune audit entries older than the configured retention window (on startup
    // here, then throttled as new entries are recorded).
    this.audit.setRetentionProvider(() => this.cfg.security.logRetentionDays);
    this.approvals = new ApprovalStore(this.paths);

    this.pathGuard = new PathGuard(this.cfg.security.allowedDirectories);
    this.pathGuard.setMode(this.cfg.security.mode);
    this.commandGuard = new CommandGuard(this.cfg.security.allowedCommands, this.cfg.security.blockedCommandTokens);
    this.commandGuard.setMode(this.cfg.security.mode);

    this.fs = new FsManager(this.pathGuard, this.paths, () => this.cfg);
    this.assetBridge = new AssetManager(this.fs, () => this.cfg);
    this.git = new GitManager(this.pathGuard);
    this.lsp = new LspService(this.pathGuard);
    this.shell = new ShellManager(this.commandGuard, this.pathGuard, () => this.cfg);
    this.skills = new SkillRuntime(this.paths, (names) => this.resolveSecrets(names));
    this.agents = new CodingAgentManager(() => this.cfg, this.git, this.commandGuard, this.pathGuard);
    // Autopilot wraps the coding-agent CLIs as internal providers. The agents
    // are no longer public tools; ChatGPT reaches them only via `autopilot`.
    this.providers = new ProviderRegistry(() => this.cfg, this.agents, this.git);
    this.autopilot = new AutopilotEngine(() => this.cfg, this.providers, this.pathGuard);
    this.tunnel = new TunnelManager(
      () => this.cfg,
      (patch) => {
        this.cfg = this.configStore.update(patch);
        this.applyConfig();
      }
    );
    this.bridge = new McpBridge(
      () => this.cfg,
      (name) => this.vault.get(name),
    );
  }

  config(): Config {
    return this.cfg;
  }

  reloadConfig(): Config {
    this.cfg = this.configStore.load();
    this.applyConfig();
    return this.cfg;
  }

  saveConfig(next: Config): Config {
    // Core blocked tokens can never be removed, regardless of mode or what the
    // dashboard/config tried to set. Union them back in before persisting.
    const blocked = Array.from(
      new Set([...CORE_BLOCKED_COMMAND_TOKENS, ...next.security.blockedCommandTokens]),
    );
    const guarded: Config = {
      ...next,
      security: { ...next.security, blockedCommandTokens: blocked },
    };
    this.cfg = this.configStore.save(guarded);
    this.applyConfig();
    return this.cfg;
  }

  private applyConfig(): void {
    this.pathGuard.setMode(this.cfg.security.mode);
    this.pathGuard.setAllowedDirectories(this.cfg.security.allowedDirectories);
    this.commandGuard.setMode(this.cfg.security.mode);
    this.commandGuard.setAllowed(this.cfg.security.allowedCommands);
    this.commandGuard.setBlocked(this.cfg.security.blockedCommandTokens);
  }

  /** Resolve only the named secrets (used by skill runtime after permission check). */
  private resolveSecrets(names: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of names) {
      const v = this.vault.get(name);
      if (v !== undefined) out[name] = v;
    }
    return out;
  }

  /**
   * Execute a registered tool with the full safety pipeline:
   * input validation → approval gate → execution → redaction → audit.
   */
  async executeTool(name: string, rawInput: unknown, ctx: ToolCallContext): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

    // Profile gate: in the `minimal` profile only the core surface is callable.
    // Everything else should go through shell / a coding agent / a skill, or the
    // user can switch tools.profile to `full`.
    const profile = this.cfg.tools.profile;
    if (!isToolInProfile(name, profile)) {
      return {
        ok: false,
        error:
          `Tool "${name}" is not available in the "${profile}" tool profile. ` +
          `Use shell_run_allowed_command, the high-level autopilot tool, ` +
          `or a skill (skill_run) instead — or set tools.profile to "full" in the config.`,
      };
    }

    const start = Date.now();
    let input: unknown;
    try {
      input = tool.inputSchema.parse(rawInput ?? {});
    } catch (e) {
      return { ok: false, error: `Invalid input for ${name}: ${describeError(e)}` };
    }

    // What gets written to the audit log — a tool may sanitize bulky/sensitive
    // payloads (e.g. base64 image chunks) out of the recorded input.
    const auditInput = tool.auditInput ? safeAuditInput(tool, input) : input;

    const requirement = approvalRequirementForMode(this.cfg.security.mode, tool.risk, this.cfg.security.approveRisk1);
    if (requirement !== "none") {
      const gate = this.checkApproval(name, tool.risk, requirement, ctx, summarize(tool, input));
      if (!gate.allowed) {
        this.audit.record({
          tool: name,
          caller: ctx.caller,
          risk: tool.risk,
          input: auditInput,
          output: { approvalRequired: gate.approvalId },
          approval: "denied",
          durationMs: Date.now() - start,
          sessionId: ctx.sessionId,
        });
        return {
          ok: false,
          approvalRequired: {
            approvalId: gate.approvalId!,
            risk: tool.risk,
            requirement,
            message: gate.message!,
          },
        };
      }
    }

    try {
      const result = await tool.handler(input, ctx);
      const safe = redactDeep(result, this.vault.allValues());
      this.audit.record({
        tool: name,
        caller: ctx.caller,
        risk: tool.risk,
        input: auditInput,
        output: safe,
        approval: requirement === "none" ? "not-required" : "approved",
        durationMs: Date.now() - start,
        sessionId: ctx.sessionId,
      });
      return { ok: true, data: safe };
    } catch (e) {
      const msg = describeError(e);
      this.audit.record({
        tool: name,
        caller: ctx.caller,
        risk: tool.risk,
        input: auditInput,
        output: null,
        approval: requirement === "none" ? "not-required" : "approved",
        durationMs: Date.now() - start,
        error: msg,
        sessionId: ctx.sessionId,
      });
      return { ok: false, error: msg };
    }
  }

  private checkApproval(
    tool: string,
    risk: 0 | 1 | 2 | 3 | 4,
    requirement: "single" | "double",
    ctx: ToolCallContext,
    summary: string,
  ): { allowed: boolean; approvalId?: string; message?: string } {
    if (this.approvals.hasSessionGrant(ctx.sessionId, tool)) {
      return { allowed: true };
    }
    const approved = this.approvals.findApprovedForTool(tool, ctx.sessionId);
    if (approved) {
      this.approvals.consume(approved.id);
      log.info(`consumed approval ${approved.id} for ${tool}`);
      return { allowed: true };
    }
    const req = this.approvals.create({
      tool,
      risk,
      requirement,
      reason: `Risk ${risk} (${RISK_LABELS[risk]}). Requires ${requirement} approval.`,
      summary,
      caller: ctx.caller,
      sessionId: ctx.sessionId,
    });
    return {
      allowed: false,
      approvalId: req.id,
      message:
        `Approval required (risk ${risk}, ${requirement}). ` +
        `Ask the user to approve in the dashboard or run: ` +
        `localant approvals approve ${req.id}. ` +
        `Then call this tool again.`,
    };
  }

  /** Stop the current tunnel (if any) and start a fresh one on the live port. */
  async restartTunnel() {
    this.tunnel.stop();
    return this.tunnel.start(this.gatewayPort());
  }

  runtimeInfo() {
    const dashPort = this.boundDashboardPort ?? this.cfg.dashboard.port;
    return {
      version: APP_VERSION,
      startedAt: this.startedAt,
      pid: process.pid,
      host: os.hostname(),
      platform: process.platform,
      node: process.version,
      gateway: `http://${this.cfg.gateway.host}:${this.gatewayPort()}`,
      dashboard: this.cfg.dashboard.enabled ? `http://127.0.0.1:${dashPort}` : undefined,
      tunnel: this.tunnel.current(),
    };
  }
}

/**
 * Map a security mode + tool risk to an approval requirement.
 *  - strict: full per-risk policy (allowlist enforcement happens in the guards).
 *  - open: deny-list deployment for personal use — only risk-4
 *    (destructive/publish/deploy) actions need approval. Everything else runs
 *    subject to the sensitive blocklist + core blocked tokens.
 *  - yolo: no approval gates at all (blocklist still applies).
 */
export function approvalRequirementForMode(
  mode: SecurityMode,
  risk: RiskLevel,
  approveRisk1: boolean,
): ApprovalRequirement {
  if (mode === "yolo") return "none";
  if (mode === "open") return risk >= 4 ? approvalFor(risk, { approveRisk1 }) : "none";
  return approvalFor(risk, { approveRisk1 });
}

function safeAuditInput(tool: { auditInput?: (i: any) => unknown }, input: unknown): unknown {
  try {
    return tool.auditInput ? tool.auditInput(input) : input;
  } catch {
    return "(input omitted)";
  }
}

function summarize(tool: { summarize?: (i: any) => string }, input: unknown): string {
  try {
    return tool.summarize ? tool.summarize(input) : JSON.stringify(input).slice(0, 200);
  } catch {
    return "(input)";
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
