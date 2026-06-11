import { spawn, type ChildProcess } from "node:child_process";
import { createLogger, type Config } from "@localant/shared";
import { commandExists } from "../util/exec.js";

const log = createLogger("tunnel");

export interface TunnelInfo {
  provider: string;
  url?: string;
  status: "starting" | "running" | "stopped" | "error";
  error?: string;
}

/**
 * Starts a public tunnel to the local gateway so ChatGPT can reach /mcp.
 * Order of preference: cloudflared → ngrok → user-provided publicUrl.
 */
export class TunnelManager {
  private child?: ChildProcess;
  private info: TunnelInfo = { provider: "none", status: "stopped" };

  constructor(
    private readonly config: () => Config,
    private readonly updateConfig?: (patch: Partial<Config>) => void,
  ) {}

  current(): TunnelInfo {
    return this.info;
  }

  async start(port: number): Promise<TunnelInfo> {
    const cfg = this.config().tunnel;
    if (cfg.publicUrl) {
      this.info = { provider: "user-provided", url: cfg.publicUrl, status: "running" };
      return this.info;
    }
    if (cfg.provider === "cloudflared" && (await commandExists("cloudflared"))) {
      return this.startCloudflared(port);
    }
    if (cfg.provider === "ngrok" && (await commandExists("ngrok"))) {
      return this.startNgrok(port);
    }
    if (cfg.provider === "localtunnel") {
      return this.startLocaltunnel(port);
    }
    if (cfg.provider === "serveo" && (await commandExists("ssh"))) {
      return this.startServeo(port);
    }
    // Fallbacks
    if (await commandExists("cloudflared")) return this.startCloudflared(port);
    if (await commandExists("ngrok")) return this.startNgrok(port);
    if (await commandExists("ssh")) return this.startServeo(port);

    this.info = {
      provider: "none",
      status: "error",
      error:
        "No tunnel provider found. Install cloudflared or ngrok, or set tunnel.publicUrl in config to a public HTTPS URL.",
    };
    return this.info;
  }

  private startCloudflared(port: number): Promise<TunnelInfo> {
    return new Promise((resolve) => {
      this.info = { provider: "cloudflared", status: "starting" };
      const cfg = this.config().tunnel;
      let args: string[];
      if (cfg.token) {
        args = ["tunnel", "run", "--token", cfg.token];
      } else {
        args = ["tunnel", "--url", `http://127.0.0.1:${port}`];
      }
      const child = spawn("cloudflared", args, { shell: false });
      this.child = child;

      if (cfg.token) {
        this.info = { provider: "cloudflared", url: cfg.publicUrl || "Zero Trust Tunnel", status: "running" };
        resolve(this.info);
        return;
      }

      const onData = (buf: Buffer) => {
        const text = buf.toString("utf8");
        const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m && this.info.status !== "running") {
          this.info = { provider: "cloudflared", url: m[0], status: "running" };
          resolve(this.info);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        this.info = { provider: "cloudflared", status: "error", error: e.message };
        resolve(this.info);
      });
      setTimeout(() => {
        if (this.info.status !== "running") {
          this.info = { provider: "cloudflared", status: "error", error: "Timed out waiting for tunnel URL." };
          resolve(this.info);
        }
      }, 20_000);
    });
  }

  private startNgrok(port: number): Promise<TunnelInfo> {
    return new Promise((resolve) => {
      this.info = { provider: "ngrok", status: "starting" };
      const cfg = this.config().tunnel;
      const args = ["http", String(port), "--log", "stdout"];
      if (cfg.domain) {
        args.push("--domain", cfg.domain);
      }
      if (cfg.token) {
        args.push("--authtoken", cfg.token);
      }
      const child = spawn("ngrok", args, { shell: false });
      this.child = child;
      const onData = (buf: Buffer) => {
        const text = buf.toString("utf8");
        const m = text.match(/https:\/\/[a-z0-9-]+\.ngrok[a-z0-9.-]*\.(app|io)/i);
        if (m && this.info.status !== "running") {
          this.info = { provider: "ngrok", url: m[0], status: "running" };
          resolve(this.info);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        this.info = { provider: "ngrok", status: "error", error: e.message };
        resolve(this.info);
      });
      setTimeout(() => {
        if (this.info.status !== "running") {
          if (cfg.domain) {
            this.info = { provider: "ngrok", url: cfg.publicUrl || `https://${cfg.domain}`, status: "running" };
            resolve(this.info);
          } else {
            this.info = { provider: "ngrok", status: "error", error: "Timed out waiting for ngrok URL." };
            resolve(this.info);
          }
        }
      }, 20_000);
    });
  }

  private async startLocaltunnel(port: number): Promise<TunnelInfo> {
    const maxDurationMs = 5 * 60 * 1000; // 5 minutes
    const intervalMs = 10000; // 10 seconds
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      attempt++;
      log.info(`Starting localtunnel attempt ${attempt}...`);
      try {
        const tunnelInfo = await this.tryStartLocaltunnelOnce(port);
        
        if (tunnelInfo.status === "running" && tunnelInfo.url) {
          const cfg = this.config().tunnel;
          const assignedUrl = tunnelInfo.url;
          const assignedSubdomain = assignedUrl.match(/https:\/\/([a-z0-9-]+)\./i)?.[1];
          const requestedSubdomain = cfg.subdomain;

          if (requestedSubdomain && assignedSubdomain && assignedSubdomain !== requestedSubdomain) {
            // We asked for our fixed subdomain but localtunnel handed back a
            // different one — the requested name is still held, almost always by
            // our own just-killed previous session (a quick restart). The public
            // URL must stay stable so the ChatGPT connector keeps working across
            // restarts, so we never regenerate: drop this throwaway tunnel and
            // keep retrying the SAME subdomain until the server releases it.
            log.warn(
              `Subdomain "${requestedSubdomain}" not yet available (got "${assignedSubdomain}"). ` +
                `Waiting for the previous session to release it, retrying in ${intervalMs / 1000}s...`,
            );
            this.stop();
            if (Date.now() - startTime >= maxDurationMs) {
              return {
                provider: "localtunnel",
                status: "error",
                error: `Subdomain "${requestedSubdomain}" did not become available within ${maxDurationMs / 1000}s.`,
              };
            }
            await new Promise((r) => setTimeout(r, intervalMs));
            continue;
          }

          return tunnelInfo;
        }

        throw new Error(tunnelInfo.error || "Unknown error starting tunnel");
      } catch (err: any) {
        log.warn(`Localtunnel start failed: ${err.message}. Retrying in 10s...`);
        this.stop();
        if (Date.now() - startTime >= maxDurationMs) {
          this.info = { provider: "localtunnel", status: "error", error: `Timed out trying to start tunnel: ${err.message}` };
          return this.info;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  private tryStartLocaltunnelOnce(port: number): Promise<TunnelInfo> {
    return new Promise((resolve) => {
      this.info = { provider: "localtunnel", status: "starting" };
      const cfg = this.config().tunnel;
      const args = ["localtunnel", "--port", String(port)];
      if (cfg.subdomain) {
        args.push("--subdomain", cfg.subdomain);
      }
      const child = spawn("npx", args, { shell: true });
      this.child = child;
      const onData = (buf: Buffer) => {
        const text = buf.toString("utf8");
        const m = text.match(/https:\/\/[a-z0-9-]+\.(localtunnel\.me|loca\.lt)/i);
        if (m && this.info.status !== "running") {
          this.info = { provider: "localtunnel", url: m[0], status: "running" };
          resolve(this.info);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        this.info = { provider: "localtunnel", status: "error", error: e.message };
        resolve(this.info);
      });
      setTimeout(() => {
        if (this.info.status !== "running") {
          if (cfg.subdomain) {
            this.info = { provider: "localtunnel", url: cfg.publicUrl || `https://${cfg.subdomain}.loca.lt`, status: "running" };
            resolve(this.info);
          } else {
            this.info = { provider: "localtunnel", status: "error", error: "Timed out waiting for localtunnel URL." };
            resolve(this.info);
          }
        }
      }, 20_000);
    });
  }

  private startServeo(port: number): Promise<TunnelInfo> {
    return new Promise((resolve) => {
      this.info = { provider: "serveo", status: "starting" };
      const cfg = this.config().tunnel;
      const subdomain = cfg.subdomain ? `${cfg.subdomain}:` : "";
      const args = ["-R", `${subdomain}80:127.0.0.1:${port}`, "-o", "StrictHostKeyChecking=no", "serveo.net"];
      const child = spawn("ssh", args, { shell: false });
      this.child = child;
      const onData = (buf: Buffer) => {
        const text = buf.toString("utf8");

        // 登録警告URLを検出
        const regMatch = text.match(/https:\/\/console\.serveo\.net\/ssh\/keys\?add=[^\s]+/i);
        if (regMatch && this.info.status !== "error") {
          const registerUrl = regMatch[0];
          log.warn(`SSH key registration required: ${registerUrl}`);
          openBrowser(registerUrl);

          this.info = {
            provider: "serveo",
            status: "error",
            error: `SSH key not registered with serveo.net. Opening registration page: ${registerUrl}`,
          };
          resolve(this.info);
          return;
        }

        const m = text.match(/https:\/\/(?!console\b)[a-z0-9-]+\.serveo\.net/i);
        if (m && this.info.status !== "running" && this.info.status !== "error") {
          this.info = { provider: "serveo", url: m[0], status: "running" };
          resolve(this.info);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        this.info = { provider: "serveo", status: "error", error: e.message };
        resolve(this.info);
      });
      setTimeout(() => {
        if (this.info.status !== "running" && this.info.status !== "error") {
          if (cfg.subdomain) {
            this.info = { provider: "serveo", url: cfg.publicUrl || `https://${cfg.subdomain}.serveo.net`, status: "running" };
            resolve(this.info);
          } else {
            this.info = { provider: "serveo", status: "error", error: "Timed out waiting for serveo URL." };
            resolve(this.info);
          }
        }
      }, 20_000);
    });
  }

  stop(): void {
    if (this.child) {
      log.info("stopping tunnel");
      this.child.kill("SIGTERM");
      this.child = undefined;
    }
    this.info = { provider: this.info.provider, status: "stopped" };
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* ignore */
  }
}
