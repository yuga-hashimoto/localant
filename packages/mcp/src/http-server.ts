import http from "node:http";
import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLogger, findAvailablePort } from "@localant/shared";
import type { Gateway } from "@localant/gateway";
import { dashboardHtml } from "@localant/dashboard";
import { buildMcpServer } from "./mcp-server.js";

const log = createLogger("http");

/** Constant-time token comparison. */
function tokenMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function extractToken(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const key = req.query.key;
  if (typeof key === "string") return key;
  const headerKey = req.header("x-cla-token");
  if (headerKey) return headerKey;
  return undefined;
}

export interface Servers {
  gateway: http.Server;
  dashboard?: http.Server;
  /** Port the gateway actually bound to (may differ from config on collision). */
  gatewayPort: number;
  /** Port the dashboard actually bound to, if enabled. */
  dashboardPort?: number;
}

/**
 * Start the public gateway server (/healthz, /status, /mcp) and the local-only
 * dashboard server. /mcp requires the auth token.
 */
export async function startHttpServers(gw: Gateway): Promise<Servers> {
  const cfg = gw.config();
  const token = gw.configStore.getToken();

  // ---------- Public gateway app ----------
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  app.get("/healthz", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
  app.get("/status", (_req, res) => res.json(gw.runtimeInfo()));

  const requireAuth = (req: Request, res: Response): boolean => {
    const provided = extractToken(req);
    if (!provided || !tokenMatches(provided, token)) {
      res.status(401).json({ error: "Unauthorized. Provide the auth token via Authorization: Bearer <token> or ?key=<token>." });
      return false;
    }
    return true;
  };

  // Streamable HTTP MCP endpoint (stateless: one server+transport per request).
  app.post("/mcp", async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const server = buildMcpServer(gw);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp request failed", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal MCP error" });
    }
  });
  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ error: "Method not allowed. Use POST for /mcp." });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const gatewayPort = await findAvailablePort(cfg.gateway.port, cfg.gateway.host);
  if (gatewayPort !== cfg.gateway.port) {
    log.info(`port ${cfg.gateway.port} is busy — falling back to ${gatewayPort}`);
  }
  const gatewayServer = await listen(app, gatewayPort, cfg.gateway.host);
  log.info(`gateway listening on http://${cfg.gateway.host}:${gatewayPort}`);

  // ---------- Local-only dashboard app ----------
  let dashboardServer: http.Server | undefined;
  let dashboardPort: number | undefined;
  if (cfg.dashboard.enabled) {
    dashboardPort = await findAvailablePort(cfg.dashboard.port, "127.0.0.1", [gatewayPort]);
    const dash = express();
    dash.use(express.json({ limit: "2mb" }));
    mountDashboardApi(dash, gw);
    dash.get("/", (_req, res) => res.type("html").send(dashboardHtml()));
    dashboardServer = await listen(dash, dashboardPort, "127.0.0.1");
    log.info(`dashboard listening on http://127.0.0.1:${dashboardPort}`);
  }

  gw.setBoundPorts(gatewayPort, dashboardPort);
  return { gateway: gatewayServer, dashboard: dashboardServer, gatewayPort, dashboardPort };
}

/** Dashboard API — bound to 127.0.0.1 only, so no external auth is required. */
function mountDashboardApi(app: express.Express, gw: Gateway): void {
  const r = express.Router();
  r.get("/status", (_q, s) => s.json(gw.runtimeInfo()));
  r.get("/health", (_q, s) => s.json({ status: "ok", version: "1.0.0", time: new Date().toISOString() }));
  r.get("/config", (_q, s) => s.json(gw.config()));
  r.get("/mcp-endpoint", (_q, s) => {
    const t = gw.tunnel.current();
    s.json({ endpoint: t.url ? `${t.url.replace(/\/$/, "")}/mcp?key=${gw.configStore.getToken()}` : null, tunnel: t });
  });
  r.get("/approvals", (_q, s) => s.json(gw.approvals.listPending()));
  r.post("/approvals/:id/approve", (q, s) => s.json(gw.approvals.approve(q.params.id, q.body?.scope === "session" ? "session" : "once") ?? { error: "not found" }));
  r.post("/approvals/:id/deny", (q, s) => s.json(gw.approvals.deny(q.params.id) ?? { error: "not found" }));
  r.get("/audit", (_q, s) => s.json(gw.audit.list(100)));
  r.get("/skills", (_q, s) =>
    s.json(
      gw.skills.list().map((sk) => ({
        name: sk.manifest.name,
        version: sk.manifest.version,
        description: sk.manifest.description,
        enabled: sk.enabled,
        generated: sk.generated,
        riskLevel: sk.manifest.riskLevel,
        valid: sk.valid,
        tools: sk.manifest.tools.map((t) => t.name),
      })),
    ),
  );
  r.post("/skills/:name/enable", (q, s) => {
    try {
      s.json(gw.skills.setEnabled(q.params.name, true));
    } catch (e) {
      s.status(400).json({ error: (e as Error).message });
    }
  });
  r.post("/skills/:name/disable", (q, s) => s.json(gw.skills.setEnabled(q.params.name, false)));
  r.get("/projects", (_q, s) => s.json(gw.projects.list()));
  r.get("/secrets", (_q, s) => s.json({ names: gw.vault.list() }));
  r.get("/agents", async (_q, s) => s.json(await gw.agents.list()));
  app.use("/api", r);
}

function listen(app: express.Express, port: number, host: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
