import { z } from "zod";
import { APP_VERSION, isToolInProfile } from "@localant/shared";
import type { Gateway } from "../gateway.js";
import { commandExists } from "../util/exec.js";
import { resolveOptionalDep } from "../util/optional-deps-path.js";
import { resolveTailscale } from "../managers/tunnel-manager.js";
import { resolveProviderOrder } from "../autopilot/settings.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Classify recent audit entries into errors / blocks / timeouts for triage. */
function recentTrouble(gw: Gateway): {
  errors: { tool: string; error: string; at: string }[];
  blocks: { tool: string; at: string }[];
  timeouts: { tool: string; at: string }[];
} {
  const entries = gw.audit.list(200);
  const errors: { tool: string; error: string; at: string }[] = [];
  const blocks: { tool: string; at: string }[] = [];
  const timeouts: { tool: string; at: string }[] = [];
  for (const e of entries) {
    if (e.approval === "denied") blocks.push({ tool: e.tool, at: e.timestamp });
    if (e.error) {
      if (/timed out|timeout|sigkill/i.test(e.error)) timeouts.push({ tool: e.tool, at: e.timestamp });
      else errors.push({ tool: e.tool, error: e.error, at: e.timestamp });
    }
  }
  return { errors: errors.slice(0, 10), blocks: blocks.slice(0, 10), timeouts: timeouts.slice(0, 10) };
}

export function registerDoctorTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "localant_doctor",
    description:
      "Read-only diagnostics for LocalAnt: connection/version, exposed tool count, allowed directories, tunnel/Tailscale state, OS permissions, screenshot capability, Git/GitHub CLI, Node/pnpm/Python runtimes, browser automation, ADB, automation provider availability, and recent errors/blocks/timeouts. Returns structured JSON. Risk 0.",
    risk: 0,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      const cfg = gw.config();
      const info = gw.runtimeInfo();
      const profile = cfg.tools.profile;
      const allTools = gw.registry.list();
      const exposed = allTools.filter((t) => isToolInProfile(t.name, profile));

      const [git, gh, pnpm, npm, npx, python, adb, screencapture, tailscale] = await Promise.all([
        commandExists("git"),
        commandExists("gh"),
        commandExists("pnpm"),
        commandExists("npm"),
        commandExists("npx"),
        commandExists("python3"),
        commandExists("adb"),
        process.platform === "darwin" ? commandExists("screencapture") : Promise.resolve(false),
        resolveTailscale().then((t) => t !== null),
      ]);

      // Provider availability (naming the backend is allowed here).
      const order = resolveProviderOrder(cfg);
      const providers = await Promise.all(
        gw.providers.list().map(async (p) => {
          const a = await p.available();
          return { id: p.id, label: p.label, available: a.available, enabled: a.enabled, reason: a.reason };
        }),
      );

      const browserAutomation = resolveOptionalDep("playwright") !== null || resolveOptionalDep("playwright-core") !== null;

      const requiredOk = git; // node runs us; git is the only external hard requirement.

      return {
        ok: requiredOk,
        version: APP_VERSION,
        startedAt: info.startedAt,
        pid: process.pid,
        platform: process.platform,
        node: process.version,
        connection: {
          gateway: info.gateway,
          dashboard: info.dashboard ?? null,
          mcpEndpoint: info.tunnel?.url ? `${info.tunnel.url.replace(/\/$/, "")}/mcp` : null,
          tunnel: info.tunnel,
        },
        tools: { profile, exposed: exposed.length, registered: allTools.length },
        security: { mode: cfg.security.mode, allowedDirectories: cfg.security.allowedDirectories },
        tunnel: info.tunnel,
        tailscale: { available: tailscale },
        permissions: {
          // Best-effort capability probe; full TCC/permission state isn't
          // readable without prompting, so we report the tool's presence.
          screenshot: process.platform === "darwin" ? screencapture : true,
        },
        git: { available: git },
        githubCli: { available: gh },
        runtimes: { node: process.version, pnpm, npm, npx, python: python },
        browserAutomation: { available: browserAutomation },
        adb: { available: adb },
        autopilot: {
          primary: cfg.autopilot.primary,
          order,
          fallbackPolicy: cfg.autopilot.fallbackPolicy,
          providers,
        },
        recent: recentTrouble(gw),
      };
    },
  });
}
