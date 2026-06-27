import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveTailscale, tailscaleEnv } from "@localant/gateway";

export interface SharedRouterRoute {
  name: string;
  prefix: string;
  target: string;
}

export interface SharedRouterConfig {
  port: number;
  routes: Record<string, SharedRouterRoute>;
}

export interface EnsureSharedRouterOptions {
  name: string;
  prefix: string;
  target: string;
  publicBaseUrl: string;
}

export interface SharedRouterRegistration {
  publicBaseUrl: string;
  routeBaseUrl: string;
}

const ROUTER_DIR = path.join(os.homedir(), ".mcp-tailscale-router");
const CONFIG_FILE = path.join(ROUTER_DIR, "config.json");
const PID_FILE = path.join(ROUTER_DIR, "router.pid");
const DEFAULT_PORT = 8790;

export function normalizeRoutePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed || trimmed.includes("..") || /[^a-zA-Z0-9._-]/.test(trimmed)) {
    throw new Error(`Invalid shared router prefix "${prefix}". Use letters, numbers, dot, underscore or dash.`);
  }
  return `/${trimmed}`;
}

export function buildRoutedMcpEndpoint(publicBaseUrl: string, prefix: string, token: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}${normalizeRoutePrefix(prefix)}/mcp?key=${encodeURIComponent(token)}`;
}

function loadRouterConfig(): SharedRouterConfig {
  if (!fs.existsSync(CONFIG_FILE)) return { port: DEFAULT_PORT, routes: {} };
  const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<SharedRouterConfig>;
  return { port: parsed.port ?? DEFAULT_PORT, routes: parsed.routes ?? {} };
}

function saveRouterConfig(config: SharedRouterConfig): void {
  fs.mkdirSync(ROUTER_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function routerHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__mcp_router/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function selectAvailableRouterPort(preferredPort: number): Promise<number> {
  if (await routerHealthy(preferredPort)) return preferredPort;
  if (await portAvailable(preferredPort)) return preferredPort;
  for (let port = DEFAULT_PORT + 1; port < DEFAULT_PORT + 100; port++) {
    if (await routerHealthy(port)) return port;
    if (await portAvailable(port)) return port;
  }
  throw new Error(`No available shared MCP router port found near ${DEFAULT_PORT}.`);
}

async function waitForRouter(port: number): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (await routerHealthy(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Shared MCP router did not start on port ${port}.`);
}

async function ensureRouterProcess(port: number): Promise<void> {
  if (await routerHealthy(port)) return;
  const child = spawn(process.execPath, [new URL("./shared-router-daemon.js", import.meta.url).pathname], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, MCP_TAILSCALE_ROUTER_CONFIG: CONFIG_FILE },
  });
  child.unref();
  fs.mkdirSync(ROUTER_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(child.pid ?? ""));
  await waitForRouter(port);
}

async function ensureTailscaleFunnel(port: number): Promise<void> {
  const bin = await resolveTailscale();
  if (!bin) throw new Error("Tailscale CLI was not found. Install Tailscale or set a non-Tailscale tunnel provider.");
  const env = tailscaleEnv();
  await new Promise<void>((resolve) => {
    const reset = spawn(bin, ["funnel", "reset"], { env, stdio: "ignore" });
    reset.on("close", () => resolve());
    reset.on("error", () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["funnel", "--bg", String(port)], { env, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Tailscale Funnel failed to publish shared router on port ${port} (exit ${code}).`));
    });
  });
}

export async function ensureSharedRouterRoute(options: EnsureSharedRouterOptions): Promise<SharedRouterRegistration> {
  const prefix = normalizeRoutePrefix(options.prefix);
  const config = loadRouterConfig();
  config.routes[options.name] = {
    name: options.name,
    prefix,
    target: options.target.replace(/\/$/, ""),
  };
  config.port = await selectAvailableRouterPort(config.port);
  saveRouterConfig(config);
  await ensureRouterProcess(config.port);
  await ensureTailscaleFunnel(config.port);
  const publicBaseUrl = options.publicBaseUrl.replace(/\/$/, "");
  return { publicBaseUrl, routeBaseUrl: `${publicBaseUrl}${prefix}` };
}

export function createSharedRouterServer(configFile = CONFIG_FILE): http.Server {
  const readConfig = (): SharedRouterConfig => {
    if (!fs.existsSync(configFile)) return { port: DEFAULT_PORT, routes: {} };
    const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as Partial<SharedRouterConfig>;
    return { port: parsed.port ?? DEFAULT_PORT, routes: parsed.routes ?? {} };
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__mcp_router/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "mcp-tailscale-router" }));
      return;
    }

    const config = readConfig();
    const route = Object.values(config.routes).find((candidate) => {
      return url.pathname === candidate.prefix || url.pathname.startsWith(`${candidate.prefix}/`);
    });
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "route_not_found" }));
      return;
    }

    const target = new URL(route.target);
    const stripped = url.pathname.slice(route.prefix.length) || "/";
    target.pathname = `${target.pathname.replace(/\/$/, "")}${stripped}`;
    target.search = url.search;

    const headers = { ...req.headers };
    headers.host = target.host;
    const proxy = http.request(
      target,
      {
        method: req.method,
        headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_error", message: err.message }));
    });
    req.pipe(proxy);
  });
}

export function routerConfigPath(): string {
  return CONFIG_FILE;
}
