import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createGateway, type Gateway } from "@localant/gateway";
import { startHttpServers, type Servers } from "@localant/mcp";

let base: string;
let gw: Gateway;
let servers: Servers;
let gatewayBase: string;
let dashboardBase: string;
let token: string;

beforeEach(async () => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-http-"));
  gw = createGateway(base);
  // Use high, likely-free ports; findAvailablePort scans upward if busy.
  gw.saveConfig({
    ...gw.config(),
    gateway: { host: "127.0.0.1", port: 18900 },
    dashboard: { enabled: true, port: 18950 },
    tunnel: { provider: "none" },
  });
  token = gw.configStore.getToken();
  servers = await startHttpServers(gw);
  gatewayBase = `http://127.0.0.1:${servers.gatewayPort}`;
  dashboardBase = `http://127.0.0.1:${servers.dashboardPort}`;
});

afterEach(async () => {
  await new Promise<void>((r) => closeAll(servers, r));
  fs.rmSync(base, { recursive: true, force: true });
});

function closeAll(s: Servers, done: () => void) {
  const toClose = [s.gateway, s.dashboard].filter(Boolean) as http.Server[];
  let n = toClose.length;
  if (n === 0) return done();
  for (const srv of toClose) srv.close(() => (--n === 0 ? done() : void 0));
}

describe("gateway /mcp auth", () => {
  it("rejects /mcp without a token (401)", async () => {
    const res = await fetch(`${gatewayBase}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects /mcp with a wrong token (401)", async () => {
    const res = await fetch(`${gatewayBase}/mcp?key=wrong-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("serves /healthz without auth", async () => {
    const res = await fetch(`${gatewayBase}/healthz`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("returns 405 for GET /mcp", async () => {
    const res = await fetch(`${gatewayBase}/mcp`);
    expect(res.status).toBe(405);
  });
});

describe("dashboard api auth", () => {
  it("rejects /api/* without the dashboard token (401)", async () => {
    const res = await fetch(`${dashboardBase}/api/status`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-local Host header (DNS-rebinding defense, 403)", async () => {
    // fetch/undici forbids overriding the Host header, so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: servers.dashboardPort, path: "/api/status", method: "GET", headers: { Host: "evil.example.com" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("serves the dashboard HTML with the embedded token", async () => {
    const res = await fetch(`${dashboardBase}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const match = html.match(/const DASH_TOKEN = "([^"]+)"/);
    expect(match).toBeTruthy();
    // The embedded token authorizes /api/*.
    const ok = await fetch(`${dashboardBase}/api/status`, {
      headers: { "x-dashboard-token": match![1] },
    });
    expect(ok.status).toBe(200);
  });
});
