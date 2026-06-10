// Standalone smoke test of the running gateway + MCP endpoint.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGateway } from "@chatgpt-local-app/gateway";
import { startHttpServers } from "@chatgpt-local-app/mcp";

const base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "smoke-"));
const gw = createGateway(base);
// Use uncommon ports to avoid collisions.
gw.saveConfig({ ...gw.config(), gateway: { host: "127.0.0.1", port: 8799 }, dashboard: { enabled: true, port: 8798 } });
const servers = await startHttpServers(gw);
const token = gw.configStore.getToken();
const BASE = "http://127.0.0.1:8799";

function rpc(method, params, id = 1) {
  return fetch(`${BASE}/mcp?key=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}
async function readBody(res) {
  const text = await res.text();
  // Streamable HTTP may return SSE; extract the JSON data line.
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5).trim() : text);
}

const out = [];
try {
  // 1. healthz
  const hz = await (await fetch(`${BASE}/healthz`)).json();
  out.push(`healthz: ${hz.status}`);

  // 2. /mcp without auth -> 401
  const noauth = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }) });
  out.push(`mcp no-auth status: ${noauth.status} (expect 401)`);

  // 3. initialize
  const initRes = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }, 1);
  const init = await readBody(initRes);
  out.push(`initialize: ${init.result ? "ok" : "FAIL"} server=${init.result?.serverInfo?.name}`);

  // 4. tools/list
  const listRes = await rpc("tools/list", {}, 2);
  const list = await readBody(listRes);
  const tools = list.result?.tools ?? [];
  out.push(`tools/list: ${tools.length} tools`);
  out.push(`  sample: ${tools.slice(0, 8).map((t) => t.name).join(", ")}`);

  // 5. call health_check
  const callRes = await rpc("tools/call", { name: "health_check", arguments: {} }, 3);
  const call = await readBody(callRes);
  const payload = JSON.parse(call.result.content[0].text);
  out.push(`health_check tool: ok=${payload.ok} status=${payload.data?.status}`);

  // 6. blocked command rejected
  const badRes = await rpc("tools/call", { name: "shell_run_allowed_command", arguments: { command: "sudo rm -rf /" } }, 4);
  const bad = JSON.parse((await readBody(badRes)).result.content[0].text);
  out.push(`blocked command: ok=${bad.ok} (expect false) error="${(bad.error || "").slice(0, 40)}…"`);

  // 7. risk-2 tool returns approvalRequired
  const apRes = await rpc("tools/call", { name: "fs_add_allowed_directory", arguments: { path: base } }, 5);
  const ap = JSON.parse((await readBody(apRes)).result.content[0].text);
  out.push(`risk-2 approval gate: approvalRequired=${Boolean(ap.approvalRequired)} (expect true)`);

  console.log("\n=== SMOKE RESULTS ===");
  console.log(out.join("\n"));
  console.log("=====================\n");
} finally {
  servers.gateway.close();
  servers.dashboard?.close();
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
}
