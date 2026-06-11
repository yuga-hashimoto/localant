import type { RiskLevel } from "./risk.js";
import type { SkillPermissions } from "./config.js";

export interface AuditEntry {
  id: string;
  timestamp: string;
  tool: string;
  caller: string;
  risk: RiskLevel;
  inputSummary: string;
  outputSummary: string;
  approval: "not-required" | "approved" | "denied" | "auto";
  durationMs: number;
  error?: string;
}

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalScope = "once" | "session";

export interface ApprovalRequest {
  id: string;
  createdAt: string;
  resolvedAt?: string;
  status: ApprovalStatus;
  tool: string;
  risk: RiskLevel;
  /** "single" or "double" — double requires two approvals. */
  requirement: "single" | "double";
  approvalsGiven: number;
  reason: string;
  summary: string;
  caller: string;
  sessionId?: string;
  scope?: ApprovalScope;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  inputSchema: Record<string, unknown>;
}

export interface SkillManifest {
  name: string;
  displayName?: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  entry: string;
  riskLevel: RiskLevel;
  permissions: SkillPermissions;
  tools: ToolManifestEntry[];
}

export interface SkillState {
  manifest: SkillManifest;
  dir: string;
  enabled: boolean;
  generated: boolean;
  installedAt: string;
  source?: string;
  valid: boolean;
  validationErrors: string[];
}

export interface RuntimeInfo {
  startedAt: string;
  gatewayUrl: string;
  dashboardUrl?: string;
  mcpEndpoint?: string;
  tunnelUrl?: string;
  tunnelProvider?: string;
  pid: number;
}

export interface CodingTask {
  id: string;
  agent: string;
  cwd: string;
  mode: "plan" | "execute";
  task: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  branch?: string;
  createdAt: string;
  finishedAt?: string;
  exitCode?: number;
  approvedPlanId?: string;
}
