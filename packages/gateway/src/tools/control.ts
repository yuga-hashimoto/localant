import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * Control-plane tools: secrets (write/list/remove — values are never returned),
 * tunnel control, and permission / risk policy. Secret VALUES are never exposed
 * through any tool; only names are listable.
 */
export function registerControlTools(gw: Gateway): void {
  const r = gw.registry;

  // --- Secrets (values never returned) ---
  r.register({
    name: "secret_set",
    description: "Store a secret by name. The value is encrypted and never returned by any tool.",
    risk: 2,
    inputSchema: z.object({ name: z.string(), value: z.string() }),
    summarize: (i) => `set secret ${i.name}`,
    handler: (i) => {
      gw.vault.set(i.name, i.value);
      return { stored: i.name };
    },
  });
  r.register({
    name: "secret_get_names",
    description: "List stored secret NAMES (never values).",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ names: gw.vault.list() }),
  });
  r.register({
    name: "secret_remove",
    description: "Remove a stored secret by name (risk 4).",
    risk: 4,
    inputSchema: z.object({ name: z.string() }),
    summarize: (i) => `remove secret ${i.name}`,
    handler: (i) => ({ removed: gw.vault.remove(i.name) }),
  });

  // --- Tunnel control ---
  r.register({
    name: "tunnel_start",
    description: "Start the public tunnel on the live gateway port.",
    risk: 2,
    inputSchema: z.object({}).strip(),
    summarize: () => "tunnel start",
    handler: async () => ({ tunnel: await gw.tunnel.start(gw.gatewayPort()) }),
  });
  r.register({
    name: "tunnel_stop",
    description: "Stop the public tunnel.",
    risk: 2,
    inputSchema: z.object({}).strip(),
    summarize: () => "tunnel stop",
    handler: () => {
      gw.tunnel.stop();
      return { stopped: true };
    },
  });
  r.register({
    name: "tunnel_restart",
    description: "Restart the public tunnel.",
    risk: 2,
    inputSchema: z.object({}).strip(),
    summarize: () => "tunnel restart",
    handler: async () => ({ tunnel: await gw.restartTunnel() }),
  });

  // --- Permission / risk policy ---
  r.register({
    name: "permission_get",
    description: "Get current security permissions (mode + allowed dirs/commands).",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const s = gw.config().security;
      return {
        mode: s.mode,
        allowedDirectories: s.allowedDirectories,
        allowedCommands: s.allowedCommands,
        blockedCommandTokens: s.blockedCommandTokens,
      };
    },
  });
  r.register({
    name: "permission_set",
    description: "Update security permissions (mode / allowedDirectories / allowedCommands).",
    risk: 2,
    inputSchema: z.object({
      mode: z.enum(["strict", "open", "yolo"]).optional(),
      allowedDirectories: z.array(z.string()).optional(),
      allowedCommands: z.array(z.string()).optional(),
    }),
    summarize: (i) => `permission_set ${i.mode ?? ""}`.trim(),
    handler: (i) => {
      const cfg = gw.config();
      gw.saveConfig({
        ...cfg,
        security: {
          ...cfg.security,
          ...(i.mode ? { mode: i.mode } : {}),
          ...(i.allowedDirectories ? { allowedDirectories: i.allowedDirectories } : {}),
          ...(i.allowedCommands ? { allowedCommands: i.allowedCommands } : {}),
        },
      });
      return { mode: gw.config().security.mode };
    },
  });
  r.register({
    name: "risk_policy_get",
    description: "Get the current risk policy (mode + whether risk-1 needs approval).",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ mode: gw.config().security.mode, approveRisk1: gw.config().security.approveRisk1 }),
  });
  r.register({
    name: "risk_policy_set",
    description: "Set the risk policy (mode and/or whether risk-1 actions need approval).",
    risk: 2,
    inputSchema: z.object({
      mode: z.enum(["strict", "open", "yolo"]).optional(),
      approveRisk1: z.boolean().optional(),
    }),
    summarize: () => "risk_policy_set",
    handler: (i) => {
      const cfg = gw.config();
      gw.saveConfig({
        ...cfg,
        security: {
          ...cfg.security,
          ...(i.mode ? { mode: i.mode } : {}),
          ...(i.approveRisk1 !== undefined ? { approveRisk1: i.approveRisk1 } : {}),
        },
      });
      return { mode: gw.config().security.mode, approveRisk1: gw.config().security.approveRisk1 };
    },
  });
}
