import { z } from "zod";
import { ConfigSchema } from "@localant/shared";
import type { Gateway } from "../gateway.js";

const VERSION = "1.0.0";

export function registerSystemTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "health_check",
    description: "Verify the local gateway is alive and reachable from ChatGPT.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ status: "ok", version: VERSION, time: new Date().toISOString(), pid: process.pid }),
  });

  r.register({
    name: "get_app_status",
    description: "Get gateway runtime status: ports, tunnel, uptime, platform.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.runtimeInfo(),
  });

  r.register({
    name: "get_version",
    description: "Return the LocalAnt version.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ version: VERSION }),
  });

  r.register({
    name: "get_config",
    description: "Return the current configuration (secrets are never included).",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.config(),
  });

  r.register({
    name: "update_config",
    description: "Patch the configuration. Pass a partial config object to merge.",
    risk: 2,
    inputSchema: z.object({ patch: z.record(z.string(), z.unknown()) }),
    summarize: (i) => `update config keys: ${Object.keys(i.patch).join(", ")}`,
    handler: (i) => {
      const merged = ConfigSchema.parse({ ...gw.config(), ...i.patch });
      return gw.saveConfig(merged);
    },
  });

  r.register({
    name: "get_dashboard_url",
    description: "Return the local dashboard URL.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ url: gw.runtimeInfo().dashboard ?? null }),
  });

  r.register({
    name: "get_mcp_endpoint",
    description: "Return the public MCP endpoint ChatGPT should connect to.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const t = gw.tunnel.current();
      return { endpoint: t.url ? `${t.url.replace(/\/$/, "")}/mcp` : null, tunnel: t };
    },
  });

  r.register({
    name: "get_tunnel_status",
    description: "Return the current tunnel provider and status.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.tunnel.current(),
  });

  r.register({
    name: "restart_gateway",
    description: "Reload configuration into the running gateway.",
    risk: 2,
    inputSchema: z.object({}).strip(),
    summarize: () => "reload gateway config",
    handler: () => ({ reloaded: true, config: gw.reloadConfig() }),
  });
}
