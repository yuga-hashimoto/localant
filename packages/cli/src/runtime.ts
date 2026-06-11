import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { createGateway, type Gateway } from "@localant/gateway";
import { startHttpServers } from "@localant/mcp";
import { c, ok, warn, copyToClipboard, openBrowser, urlBox } from "./util.js";

export interface StartOptions {
  noTunnel?: boolean;
  noOpen?: boolean;
  noClipboard?: boolean;
  quiet?: boolean;
}

async function verifyTunnelReachable(url: string): Promise<boolean> {
  const target = `${url.replace(/\/$/, "")}/healthz`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(target, { signal: ctrl.signal, redirect: "manual" });
    clearTimeout(timer);
    return resp.ok && resp.status === 200;
  } catch {
    return false;
  }
}

async function getServeoRegistrationUrl(): Promise<string | undefined> {
  try {
    const home = os.homedir();
    const pubKeyPath = path.join(home, ".ssh", "id_ed25519.pub");
    if (fs.existsSync(pubKeyPath)) {
      const output = execSync(`ssh-keygen -lf "${pubKeyPath}"`, { encoding: "utf8" });
      const m = output.match(/SHA256:([^\s]+)/);
      if (m) {
        const fingerprint = `SHA256:${m[1]}`;
        return `https://console.serveo.net/ssh/keys?add=${encodeURIComponent(fingerprint)}`;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Start the gateway, HTTP servers and (optionally) the tunnel; block forever. */
export async function runGateway(gw: Gateway, opts: StartOptions): Promise<void> {
  const cfg = gw.config();
  const servers = await startHttpServers(gw);

  let mcpEndpoint: string | undefined;
  let tunnelSuccess = false;
  let registrationUrl: string | undefined;

  if (!opts.noTunnel && cfg.tunnel.provider !== "none") {
    if (!opts.quiet) process.stdout.write(c.gray("Starting tunnel… "));
    const tunnel = await gw.tunnel.start(servers.gatewayPort);

    if (tunnel.status === "running" && tunnel.url) {
      const isReachable = await verifyTunnelReachable(tunnel.url);
      if (isReachable) {
        mcpEndpoint = `${tunnel.url.replace(/\/$/, "")}/mcp?key=${gw.configStore.getToken()}`;
        if (!opts.quiet) process.stdout.write(c.green("ok\n"));
        tunnelSuccess = true;
      } else {
        if (!opts.quiet) process.stdout.write(c.red("failed (unreachable)\n"));
        const m = (tunnel.error || "").match(/https:\/\/console\.serveo\.net\/ssh\/keys\?add=[^\s]+/i);
        registrationUrl = m ? m[0] : (cfg.tunnel.provider === "serveo" ? await getServeoRegistrationUrl() : undefined);
      }
    } else {
      if (!opts.quiet) process.stdout.write(c.yellow("unavailable\n"));
      console.log(warn(tunnel.error ?? "Tunnel not started."));
      const m = (tunnel.error || "").match(/https:\/\/console\.serveo\.net\/ssh\/keys\?add=[^\s]+/i);
      registrationUrl = m ? m[0] : (cfg.tunnel.provider === "serveo" ? await getServeoRegistrationUrl() : undefined);
    }

    // もしキー登録が必要であれば、登録するまでCLI上で待機ループに入る
    if (registrationUrl) {
      console.log("\n" + c.bold("🔑 Action Required: Register SSH Key with Serveo"));
      console.log(c.cyan("To request custom subdomains, serveo.net requires SSH key registration."));
      console.log(c.cyan("Opening registration page in your default browser:"));
      console.log(`  ${registrationUrl}\n`);

      openBrowser(registrationUrl);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      while (!tunnelSuccess) {
        await new Promise<void>((res) => {
          rl.question(c.bold("Press [Enter] after you have registered the key on the website to retry..."), () => {
            res();
          });
        });

        console.log(c.gray("Retrying tunnel connection..."));
        gw.tunnel.stop();
        const retriedTunnel = await gw.tunnel.start(servers.gatewayPort);

        if (retriedTunnel.status === "running" && retriedTunnel.url) {
          const isReachable = await verifyTunnelReachable(retriedTunnel.url);
          if (isReachable) {
            mcpEndpoint = `${retriedTunnel.url.replace(/\/$/, "")}/mcp?key=${gw.configStore.getToken()}`;
            console.log(ok("Tunnel connected successfully!\n"));
            tunnelSuccess = true;
          } else {
            console.log(warn("Tunnel still not reachable (redirected). Please ensure you clicked 'Add Key' in the browser."));
          }
        } else {
          console.log(warn(`Tunnel failed: ${retriedTunnel.error ?? "Unknown error"}`));
        }
      }
      rl.close();
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

  // トンネルの接続が完全に成功している場合（またはトンネル無しの設定の場合）のみ、ダッシュボードを開く
  if (cfg.dashboard.enabled && !opts.noOpen) {
    openBrowser(dashUrl);
  }

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
  console.log("  1. Open ChatGPT Connectors: https://chatgpt.com/#settings/Connectors");
  console.log("  2. Advanced settings → Developer Mode ON");
  console.log("  3. Connectors → Create");
  console.log(`  4. Paste the MCP URL above${mcpEndpoint ? "" : " (start the tunnel first)"}`);
  console.log('  5. Set Authentication to "None"');
  console.log("  6. Name it: LocalAnt");
  console.log("");
  console.log(`Then ask ChatGPT: ${c.cyan('"Run health check on my local app"')}`);

  if (rt.tunnel?.url && /trycloudflare\.com/.test(rt.tunnel.url)) {
    console.log("");
    console.log(warn("This is a temporary Quick Tunnel URL — it changes on every restart,"));
    console.log(c.yellow("   so you'll have to recreate the ChatGPT connector each time."));
    console.log(c.gray("   For a permanent URL (recreate the connector once, never again):"));
    console.log(c.gray("     • ngrok static domain (free):  set tunnel.provider=ngrok, tunnel.token, tunnel.domain"));
    console.log(c.gray("     • custom subdomain (no signup): set tunnel.provider=localtunnel, tunnel.subdomain"));
    console.log(c.gray(`     • configure it in the dashboard Settings tab, or: ${c.cyan("localant config set tunnel.domain <domain>")}`));
    console.log(c.gray("   The auth token is persistent, so a fixed URL means no re-auth. See docs/chatgpt-setup.md."));
  }
  console.log(c.gray("\nPress Ctrl+C to stop."));
}

export function newGateway(): Gateway {
  return createGateway();
}
