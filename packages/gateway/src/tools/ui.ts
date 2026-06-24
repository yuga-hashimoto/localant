import { z } from "zod";
import { APP_VERSION, isToolInProfile } from "@localant/shared";
import type { Gateway } from "../gateway.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * ChatGPT Apps SDK entry point. This read-only tool exists mostly so users can
 * say "open LocalAnt" and get a first-class UI card in ChatGPT instead of
 * having to discover a lower-level panel tool first.
 */
export function registerUiTools(gw: Gateway): void {
  gw.registry.register({
    name: "localant_ui",
    description:
      "Open the LocalAnt ChatGPT UI home panel. Shows connection status, security mode, exposed tools, pending approvals, tracked processes, downstream MCP servers, installed skills, and recent audit events. Read-only; risk 0.",
    risk: 0,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const cfg = gw.config();
      const runtime = gw.runtimeInfo();
      const profile = cfg.tools.profile;
      const registeredTools = gw.registry.list();
      const exposedTools = registeredTools.filter((tool) => isToolInProfile(tool.name, profile));
      const skills = gw.skills.list().map((skill) => ({
        name: skill.manifest.name,
        version: skill.manifest.version,
        description: skill.manifest.description,
        enabled: skill.enabled,
        riskLevel: skill.manifest.riskLevel,
        valid: skill.valid,
        tools: skill.manifest.tools.map((tool) => tool.name),
      }));

      return {
        version: APP_VERSION,
        startedAt: gw.startedAt,
        pid: process.pid,
        runtime: {
          gateway: runtime.gateway,
          dashboard: runtime.dashboard ?? null,
          tunnel: runtime.tunnel,
          mcpEndpoint: runtime.tunnel?.url ? `${runtime.tunnel.url.replace(/\/$/, "")}/mcp` : null,
        },
        security: {
          mode: cfg.security.mode,
          approveRisk1: cfg.security.approveRisk1,
          allowedDirectories: cfg.security.allowedDirectories,
        },
        tools: {
          profile,
          exposed: exposedTools.length,
          registered: registeredTools.length,
        },
        approvals: gw.approvals.listPending(),
        processes: gw.shell.listProcesses(),
        mcpServers: gw.config().mcpServers,
        skills,
        recentAudit: gw.audit.list(8).map((entry) => ({
          id: entry.id,
          timestamp: entry.timestamp,
          tool: entry.tool,
          caller: entry.caller,
          risk: entry.risk,
          approval: entry.approval,
          durationMs: entry.durationMs,
          error: entry.error,
          sessionId: entry.sessionId,
        })),
      };
    },
  });
}
