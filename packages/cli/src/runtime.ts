import fs from "node:fs";
import { createGateway, type Gateway } from "@localant/gateway";
import { startHttpServers } from "@localant/mcp";
import { c, ok, warn, copyToClipboard, openBrowser, urlBox } from "./util.js";

export interface StartOptions {
  noTunnel?: boolean;
  noOpen?: boolean;
  noClipboard?: boolean;
  quiet?: boolean;
}

/** Start the gateway, HTTP servers and (optionally) the tunnel; block forever. */
export async function runGateway(gw: Gateway, opts: StartOptions): Promise<void> {
  const cfg = gw.config();
  const servers = await startHttpServers(gw);

  let mcpEndpoint: string | undefined;
  if (!opts.noTunnel && cfg.tunnel.provider !== "none") {
    if (!opts.quiet) process.stdout.write(c.gray("Starting tunnel… "));
    const tunnel = await gw.tunnel.start(servers.gatewayPort);
    if (tunnel.status === "running" && tunnel.url) {
      mcpEndpoint = `${tunnel.url.replace(/\/$/, "")}/mcp?key=${gw.configStore.getToken()}`;
      if (!opts.quiet) process.stdout.write(c.green("ok\n"));
    } else if (!opts.quiet) {
      process.stdout.write(c.yellow("unavailable\n"));
      console.log(warn(tunnel.error ?? "Tunnel not started."));
    }
  }

  // Persist runtime info + pid for `status`/`stop`.
  fs.writeFileSync(gw.paths.pidFile, String(process.pid));
  fs.writeFileSync(
    gw.paths.runtimeFile,
    JSON.stringify({ ...gw.runtimeInfo(), mcpEndpoint: mcpEndpoint ?? null }, null, 2),
  );

  if (!opts.quiet) printReady(gw, mcpEndpoint);

  const dashUrl = `http://127.0.0.1:${servers.dashboardPort ?? cfg.dashboard.port}`;
  if (mcpEndpoint && !opts.noClipboard) {
    const copied = await copyToClipboard(mcpEndpoint);
    if (copied && !opts.quiet) console.log(ok("MCP endpoint copied to clipboard"));
  }
  if (cfg.dashboard.enabled && !opts.noOpen) openBrowser(dashUrl);

  const shutdown = () => {
    gw.tunnel.stop();
    servers.gateway.close();
    servers.dashboard?.close();
    try {
      fs.rmSync(gw.paths.pidFile, { force: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive.
  await new Promise(() => {});
}

function printReady(gw: Gateway, mcpEndpoint?: string): void {
  const cfg = gw.config();
  const rt = gw.runtimeInfo();
  console.log("");
  console.log(ok(`${c.bold("LocalAnt")} is running`));
  console.log("");
  console.log(`  Local Gateway:  ${c.cyan(rt.gateway)}`);
  if (cfg.dashboard.enabled && rt.dashboard) console.log(`  Dashboard:      ${c.cyan(rt.dashboard)}`);
  console.log(`  MCP Endpoint:   ${mcpEndpoint ? c.cyan(mcpEndpoint) : c.yellow("(tunnel not running)")}`);
  console.log("");
  if (mcpEndpoint) {
    console.log(urlBox(mcpEndpoint));
    console.log("");
  }
  console.log(c.bold("Connect ChatGPT:"));
  console.log("  1. Open ChatGPT → Settings → Apps & Connectors");
  console.log("  2. Advanced settings → Developer Mode ON");
  console.log("  3. Connectors → Create");
  console.log(`  4. Paste the MCP URL above${mcpEndpoint ? "" : " (start the tunnel first)"}`);
  console.log("  5. Name it: LocalAnt");
  console.log("");
  console.log(`Then ask ChatGPT: ${c.cyan('"Run health check on my local app"')}`);
  console.log(c.gray("\nPress Ctrl+C to stop."));
}

export function newGateway(): Gateway {
  return createGateway();
}
