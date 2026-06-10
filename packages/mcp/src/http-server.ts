import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLogger, findAvailablePort, APP_VERSION, ConfigSchema } from "@localant/shared";
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

/** Hostnames considered local. Used to defend the dashboard against
 * DNS-rebinding (an attacker domain resolving to 127.0.0.1 carries its own
 * Host header, which will not be in this set). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalRequest(req: Request): boolean {
  // express strips the port from req.hostname.
  return LOCAL_HOSTS.has(req.hostname);
}

/**
 * Minimal fixed-window in-memory rate limiter keyed by client IP. No external
 * dependency; resets every `windowMs`. Returns false when the caller is over
 * the limit.
 */
function createRateLimiter(limit: number, windowMs: number): (key: string) => boolean {
  let windowStart = Date.now();
  let counts = new Map<string, number>();
  return (key: string): boolean => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      counts = new Map();
    }
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next <= limit;
  };
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
  const pendingCodes = new Map<string, { redirectUri: string; createdAt: number }>();

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

  // Rate limit the public MCP endpoint to blunt brute-force / abuse over the
  // tunnel. Generous enough for normal ChatGPT use; keyed by client IP.
  const mcpRateLimit = createRateLimiter(120, 60_000);

  // Streamable HTTP MCP endpoint (stateless: one server+transport per request).
  app.post("/mcp", async (req, res) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (!mcpRateLimit(ip)) {
      res.status(429).json({ error: "Too many requests. Slow down." });
      return;
    }
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

  // OAuth 認可エンドポイント
  app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state } = req.query;
    if (!redirect_uri) {
      return res.status(400).send("Missing redirect_uri");
    }
    const rt = gw.runtimeInfo();
    if (!rt.dashboard) {
      return res.status(500).send("Dashboard is not running, cannot authorize.");
    }
    const target = `${rt.dashboard}/#oauth/approve?state=${encodeURIComponent(String(state || ""))}&redirect_uri=${encodeURIComponent(String(redirect_uri))}`;
    res.redirect(target);
  });

  // OAuth トークンエンドポイント
  app.post("/oauth/token", express.urlencoded({ extended: true }), (req, res) => {
    const body = req.body || {};
    const { grant_type, code, redirect_uri } = body;
    if (grant_type !== "authorization_code") {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }
    if (!code) {
      return res.status(400).json({ error: "invalid_request", error_description: "Missing code" });
    }
    const pending = pendingCodes.get(code);
    if (!pending) {
      return res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired code" });
    }
    if (Date.now() - pending.createdAt > 600_000) {
      pendingCodes.delete(code);
      return res.status(400).json({ error: "invalid_grant", error_description: "Code expired" });
    }
    pendingCodes.delete(code);

    res.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 315360000,
    });
  });

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
    // Per-process token embedded in the served HTML and required on /api/*.
    // A cross-origin page cannot read the dashboard HTML (so it cannot learn
    // the token) and cannot forge the custom header without a CORS preflight
    // we never grant — this closes the CSRF / token-theft hole.
    const dashToken = crypto.randomBytes(24).toString("base64url");
    const dash = express();
    dash.use(express.json({ limit: "2mb" }));

    // DNS-rebinding defense: only serve requests whose Host is local.
    dash.use((req, res, next) => {
      if (!isLocalRequest(req)) {
        res.status(403).json({ error: "Forbidden: dashboard is local-only." });
        return;
      }
      next();
    });

    mountDashboardApi(dash, gw, dashToken, pendingCodes);
    dash.get("/favicon.png", (_req, res) => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [
        path.join(__dirname, "..", "..", "..", "assets", "hero.png"),
        path.join(__dirname, "..", "assets", "hero.png"),
        path.join(__dirname, "assets", "hero.png"),
        path.join(process.cwd(), "assets", "hero.png"),
      ];
      let found: string | undefined;
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          found = c;
          break;
        }
      }
      if (found) {
        res.sendFile(found);
      } else {
        res.status(404).end();
      }
    });
    dash.get("/", (_req, res) => res.type("html").send(dashboardHtml(dashToken)));
    dashboardServer = await listen(dash, dashboardPort, "127.0.0.1");
    log.info(`dashboard listening on http://127.0.0.1:${dashboardPort}`);
  }

  gw.setBoundPorts(gatewayPort, dashboardPort);
  return { gateway: gatewayServer, dashboard: dashboardServer, gatewayPort, dashboardPort };
}

/**
 * Dashboard API — bound to 127.0.0.1 only and additionally gated by a
 * per-process token (defends against CSRF / DNS-rebinding from a browser tab).
 */
function mountDashboardApi(
  app: express.Express,
  gw: Gateway,
  dashToken: string,
  pendingCodes: Map<string, { redirectUri: string; createdAt: number }>,
): void {
  const r = express.Router();

  r.post("/oauth/approve", (q, s) => {
    const { redirect_uri } = q.body;
    if (!redirect_uri) {
      s.status(400).json({ error: "Missing redirect_uri" });
      return;
    }
    const code = crypto.randomBytes(16).toString("hex");
    pendingCodes.set(code, {
      redirectUri: redirect_uri,
      createdAt: Date.now(),
    });
    s.json({ code });
  });

  // Require the dashboard token on every /api/* call. The token is embedded in
  // the served HTML, so the legitimate same-origin page always has it; a
  // cross-origin attacker cannot read it nor forge the custom header.
  r.use((req, res, next) => {
    const provided = req.header("x-dashboard-token");
    if (!provided || !tokenMatches(provided, dashToken)) {
      res.status(401).json({ error: "Unauthorized dashboard request." });
      return;
    }
    next();
  });

  r.get("/status", (_q, s) => s.json(gw.runtimeInfo()));
  r.get("/health", (_q, s) => s.json({ status: "ok", version: APP_VERSION, time: new Date().toISOString() }));
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
  r.post("/secrets", (q, s) => {
    try {
      const { name, value } = q.body;
      if (!name || !value) {
        s.status(400).json({ error: "Name and value are required." });
        return;
      }
      gw.vault.set(name, value);
      s.json({ ok: true });
    } catch (e) {
      s.status(400).json({ error: (e as Error).message });
    }
  });
  r.delete("/secrets/:name", (q, s) => {
    try {
      const ok = gw.vault.remove(q.params.name);
      s.json({ ok });
    } catch (e) {
      s.status(400).json({ error: (e as Error).message });
    }
  });
  r.post("/config", (q, s) => {
    try {
      const current = gw.config();
      const next = mergeConfig(current, q.body);
      const parsed = ConfigSchema.parse(next);
      const saved = gw.saveConfig(parsed);
      s.json(saved);
    } catch (e) {
      s.status(400).json({ error: (e as Error).message });
    }
  });
  r.get("/agents", async (_q, s) => s.json(await gw.agents.list()));
  app.use("/api", r);
}

function mergeConfig(current: any, update: any): any {
  const next = { ...current };
  for (const key of Object.keys(update)) {
    if (update[key] !== null && typeof update[key] === "object" && !Array.isArray(update[key])) {
      next[key] = mergeConfig(next[key] || {}, update[key]);
    } else {
      next[key] = update[key];
    }
  }
  return next;
}

function listen(app: express.Express, port: number, host: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
