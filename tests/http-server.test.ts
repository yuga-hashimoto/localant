import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
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

// This suite stands up its own gateway + servers once (beforeAll/afterAll) on
// distinct ports, so there is no per-test server churn — which otherwise makes
// undici reuse a pooled socket against a recreated server (flaky ECONNRESET).
describe("dashboard api routes", () => {
  let apiBase: string;
  let apiGw: Gateway;
  let apiServers: Servers;
  let apiBaseDir: string;
  let dashToken: string;
  const apiGet = (p: string) => fetch(`${apiBase}/api/${p}`, { headers: { "x-dashboard-token": dashToken } });
  const apiSend = (p: string, method: string, body?: unknown) =>
    fetch(`${apiBase}/api/${p}`, {
      method,
      headers: { "x-dashboard-token": dashToken, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
    apiBaseDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-api-"));
    apiGw = createGateway(apiBaseDir);
    apiGw.saveConfig({
      ...apiGw.config(),
      gateway: { host: "127.0.0.1", port: 18910 },
      dashboard: { enabled: true, port: 18960 },
      tunnel: { provider: "none" },
    });
    apiServers = await startHttpServers(apiGw);
    apiBase = `http://127.0.0.1:${apiServers.dashboardPort}`;
    const html = await (await fetch(`${apiBase}/`)).text();
    dashToken = html.match(/const DASH_TOKEN = "([^"]+)"/)![1]!;
  });

  afterAll(async () => {
    await new Promise<void>((r) => closeAll(apiServers, r));
    fs.rmSync(apiBaseDir, { recursive: true, force: true });
  });

  it("toggles a coding agent's enabled flag", async () => {
    const res = await apiSend("agents/codex/enable", "POST");
    expect(res.status).toBe(200);
    const agents = (await res.json()) as { agent: string; enabled: boolean }[];
    expect(agents.find((a) => a.agent === "codex")!.enabled).toBe(true);
    expect(apiGw.config().codingAgents.codex!.enabled).toBe(true);
  });

  it("returns 404 for an unknown coding agent", async () => {
    const res = await apiSend("agents/nope/enable", "POST");
    expect(res.status).toBe(404);
  });

  it("lists skills with skillsDir and bundled flag", async () => {
    const res = await apiGet("skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skillsDir: string; skills: { name: string; bundled: boolean }[] };
    expect(typeof body.skillsDir).toBe("string");
    expect(body.skills.find((s) => s.name === "hello-world")!.bundled).toBe(true);
  });

  it("creates, lists and uninstalls a skill", async () => {
    const create = await apiSend("skills", "POST", { name: "demo-skill", description: "demo" });
    expect(create.status).toBe(200);
    const detail = await apiGet("skills/demo-skill");
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { enabled: boolean }).enabled).toBe(false);
    const del = await apiSend("skills/demo-skill", "DELETE");
    expect(del.status).toBe(200);
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
  });

  it("refuses to uninstall a bundled skill", async () => {
    const res = await apiSend("skills/hello-world", "DELETE");
    expect(res.status).toBe(400);
  });

  it("registers and removes a project, rejecting bad paths", async () => {
    const dir = path.join(apiBaseDir, "myproj");
    fs.mkdirSync(dir);
    const reg = await apiSend("projects", "POST", { path: dir, name: "myproj" });
    expect(reg.status).toBe(200);
    const id = ((await reg.json()) as { id: string }).id;
    const bad = await apiSend("projects", "POST", { path: path.join(apiBaseDir, "does-not-exist") });
    expect(bad.status).toBe(400);
    const del = await apiSend(`projects/${id}`, "DELETE");
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
  });

  it("reports and stops the tunnel", async () => {
    const cur = await apiGet("tunnel");
    expect(cur.status).toBe(200);
    const stop = await apiSend("tunnel/stop", "POST");
    expect(stop.status).toBe(200);
    expect(((await stop.json()) as { status: string }).status).toBe("stopped");
  });

  it("serves the icon.svg asset", async () => {
    const res = await fetch(`${apiBase}/icon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/svg/);
  });

  it("reveals and rotates the auth token (and /mcp honors the new token)", async () => {
    const before = ((await (await apiGet("token")).json()) as { token: string }).token;
    expect(before).toBeTruthy();
    const rotated = ((await (await apiSend("token/rotate", "POST")).json()) as { token: string }).token;
    expect(rotated).not.toBe(before);
    // The old token must now be rejected and the new one accepted on /mcp.
    const gwUrl = `http://127.0.0.1:${apiServers.gatewayPort}/mcp`;
    const oldRes = await fetch(`${gwUrl}?key=${before}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(oldRes.status).toBe(401);
    const newRes = await fetch(`${gwUrl}?key=${rotated}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    });
    expect(newRes.status).not.toBe(401);
  });

  it("searches the audit log and fetches a full entry", async () => {
    // Generate an audit entry via a real tool call.
    await apiGw.executeTool("get_version", {}, { caller: "test" });
    const all = (await (await apiGet("audit")).json()) as { id: string; tool: string }[];
    expect(all.length).toBeGreaterThan(0);
    const hit = (await (await apiGet("audit?q=get_version")).json()) as { id: string }[];
    expect(hit.length).toBeGreaterThan(0);
    const detail = await apiGet("audit/" + hit[0]!.id);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { outputSummary: string }).outputSummary).toBeTruthy();
    const missing = await apiGet("audit/nope");
    expect(missing.status).toBe(404);
  });

  it("rejects an agent run with missing fields and unknown agent/project", async () => {
    const bad = await apiSend("agents/run", "POST", { agent: "codex" });
    expect(bad.status).toBe(400);
    const unknown = await apiSend("agents/run", "POST", { agent: "nope", projectId: "x", task: "do" });
    expect(unknown.status).toBe(400);
  });

  it("returns a not-reachable tunnel test when no tunnel is running", async () => {
    await apiSend("tunnel/stop", "POST");
    const res = await apiSend("tunnel/test", "POST");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reachable: boolean }).reachable).toBe(false);
  });

  it("reports the environment via /doctor", async () => {
    const res = await apiGet("doctor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { node: string; tools: { name: string; available: boolean }[] };
    expect(body.node).toMatch(/^v\d/);
    expect(body.tools.find((t) => t.name === "node")!.available).toBe(true);
  });

  it("validates skill install and run inputs", async () => {
    const noUrl = await apiSend("skills/install", "POST", {});
    expect(noUrl.status).toBe(400);
    const noTool = await apiSend("skills/hello-world/run", "POST", {});
    expect(noTool.status).toBe(400);
    // hello-world ships disabled; running it should error until enabled. (The
    // actual subprocess run is exercised by the live dashboard, not here: under
    // vitest the package resolves to TS src, whose skill-runner has no built
    // .js for the child process to load.)
    const disabled = await apiSend("skills/hello-world/run", "POST", { tool: "hello", input: {} });
    expect(disabled.status).toBe(400);
  });

  it("manages bridged MCP servers (add, toggle, remove)", async () => {
    const add = await apiSend("mcp-servers", "POST", { name: "demo-mcp", command: "echo", args: "hello world" });
    expect(add.status).toBe(200);
    const list = (await (await apiGet("mcp-servers")).json()) as { name: string; args: string[]; enabled: boolean }[];
    const found = list.find((x) => x.name === "demo-mcp")!;
    expect(found.args).toEqual(["hello", "world"]);
    expect(found.enabled).toBe(true);
    const dis = await apiSend("mcp-servers/demo-mcp/disable", "POST");
    expect(((await dis.json()) as { enabled: boolean }).enabled).toBe(false);
    const missing = await apiSend("mcp-servers/nope/enable", "POST");
    expect(missing.status).toBe(404);
    const del = await apiSend("mcp-servers/demo-mcp", "DELETE");
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
    expect(apiGw.config().mcpServers["demo-mcp"]).toBeUndefined();
  });
});
