import os from "node:os";
import {
  approvalFor,
  redactDeep,
  createLogger,
  RISK_LABELS,
  type Config,
  type AppPaths,
} from "@chatgpt-local-app/shared";
import { ConfigStore } from "./stores/config-store.js";
import { SecretVault } from "./stores/secret-vault.js";
import { AuditLog } from "./stores/audit-log.js";
import { ApprovalStore } from "./stores/approval-store.js";
import { PathGuard } from "./security/path-guard.js";
import { CommandGuard } from "./security/command-guard.js";
import { FsManager } from "./managers/fs-manager.js";
import { GitManager } from "./managers/git-manager.js";
import { ShellManager } from "./managers/shell-manager.js";
import { ProjectRegistry } from "./managers/project-registry.js";
import { SkillRuntime } from "./managers/skill-runtime.js";
import { CodingAgentManager } from "./managers/coding-agent-manager.js";
import { TunnelManager } from "./managers/tunnel-manager.js";
import { McpBridge } from "./managers/mcp-bridge.js";
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
  readonly git: GitManager;
  readonly shell: ShellManager;
  readonly projects: ProjectRegistry;
  readonly skills: SkillRuntime;
  readonly agents: CodingAgentManager;
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

    this.vault = new SecretVault(this.paths, token);
    this.audit = new AuditLog(this.paths);
    this.audit.setSecretsProvider(() => this.vault.allValues());
    this.approvals = new ApprovalStore(this.paths);

    this.pathGuard = new PathGuard(this.cfg.security.allowedDirectories);
    this.commandGuard = new CommandGuard(this.cfg.security.allowedCommands, this.cfg.security.blockedCommandTokens);

    this.fs = new FsManager(this.pathGuard, this.paths, () => this.cfg);
    this.git = new GitManager(this.pathGuard);
    this.shell = new ShellManager(this.commandGuard, this.pathGuard, () => this.cfg);
    this.projects = new ProjectRegistry(this.paths, this.pathGuard);
    this.skills = new SkillRuntime(this.paths, (names) => this.resolveSecrets(names));
    this.agents = new CodingAgentManager(() => this.cfg, this.projects, this.git);
    this.tunnel = new TunnelManager(() => this.cfg);
    this.bridge = new McpBridge(() => this.cfg);
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
    this.cfg = this.configStore.save(next);
    this.applyConfig();
    return this.cfg;
  }

  private applyConfig(): void {
    this.pathGuard.setAllowedDirectories(this.cfg.security.allowedDirectories);
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

    const start = Date.now();
    let input: unknown;
    try {
      input = tool.inputSchema.parse(rawInput ?? {});
    } catch (e) {
      return { ok: false, error: `Invalid input for ${name}: ${describeError(e)}` };
    }

    const requirement = approvalFor(tool.risk, { approveRisk1: this.cfg.security.approveRisk1 });
    if (requirement !== "none") {
      const gate = this.checkApproval(name, tool.risk, requirement, ctx, summarize(tool, input));
      if (!gate.allowed) {
        this.audit.record({
          tool: name,
          caller: ctx.caller,
          risk: tool.risk,
          input,
          output: { approvalRequired: gate.approvalId },
          approval: "denied",
          durationMs: Date.now() - start,
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
        input,
        output: safe,
        approval: requirement === "none" ? "not-required" : "approved",
        durationMs: Date.now() - start,
      });
      return { ok: true, data: safe };
    } catch (e) {
      const msg = describeError(e);
      this.audit.record({
        tool: name,
        caller: ctx.caller,
        risk: tool.risk,
        input,
        output: null,
        approval: requirement === "none" ? "not-required" : "approved",
        durationMs: Date.now() - start,
        error: msg,
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
    const approved = this.approvals.findApprovedForTool(tool);
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
        `chatgpt-local-app approvals approve ${req.id}. ` +
        `Then call this tool again.`,
    };
  }

  runtimeInfo() {
    const dashPort = this.boundDashboardPort ?? this.cfg.dashboard.port;
    return {
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
