import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createLogger, type Config } from "@localant/shared";
import { commandExists, execFileSafe, resolveExecutable } from "../util/exec.js";

const log = createLogger("tunnel");

/**
 * Resolve an invokable Tailscale CLI path, or null when Tailscale isn't
 * installed. The macOS App Store / GUI build ships the CLI inside the app
 * bundle and does NOT add `tailscale` to PATH, so a bare commandExists check
 * reports "not installed" even though Funnel is fully usable. We therefore also
 * probe the known app-bundle location.
 */
export async function resolveTailscale(): Promise<string | null> {
  if (await commandExists("tailscale")) return "tailscale";
  const bundled = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/tailscale",
  ];
  for (const candidate of bundled) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore and try the next candidate
    }
  }
  return null;
}

/**
 * Environment for invoking the bundled Tailscale CLI.
 *
 * The standalone macOS app (bundle id `io.tailscale.ipn.macsys`) ships a CLI
 * that decides how to reach the daemon based on whether `SHLVL` is set: when it
 * is, the CLI talks to the already-running daemon; when it is NOT, the CLI
 * assumes it was launched from Finder/GUI and tries to *start the Tailscale
 * GUI*, which fails headlessly with "The Tailscale GUI failed to start …
 * (Tailscale.CLIError error 3.)". launchd starts jobs without `SHLVL`, so an
 * auto-started gateway could never bring up Funnel. Seeding a non-empty `SHLVL`
 * makes the CLI take the daemon path regardless of how the gateway was launched.
 */
export function tailscaleEnv(): NodeJS.ProcessEnv {
  if (process.env.SHLVL && process.env.SHLVL.length > 0) return process.env;
  return { ...process.env, SHLVL: "1" };
}

export interface TunnelInfo {
  provider: string;
  url?: string;
  status: "starting" | "running" | "stopped" | "error";
  error?: string;
}

/**
 * Starts a public tunnel to the local gateway so ChatGPT can reach /mcp.
 * Order of preference: user-provided publicUrl → Tailscale Funnel → cloudflared → ngrok → serveo.
 */
export class TunnelManager {
  private child?: ChildProcess;
  private info: TunnelInfo = { provider: "none", status: "stopped" };
  private timeoutId?: NodeJS.Timeout;
  /** Set by stop() so an intentional shutdown is never auto-reconnected. */
  private stopped = false;
  /** Pending serveo reconnect attempt, cleared on stop(). */
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: () => Config,
    private readonly updateConfig?: (patch: Partial<Config>) => void,
  ) {}

  current(): TunnelInfo {
    return this.info;
  }

  async start(port: number): Promise<TunnelInfo> {
    this.stopped = false;
    const cfg = this.config().tunnel;
    if (cfg.publicUrl) {
      this.info = { provider: "user-provided", url: cfg.publicUrl, status: "running" };
      return this.info;
    }

    // Try the configured provider first, then fall back through the others. A
    // provider that is unavailable (binary missing) or that starts but never
    // publishes a URL (e.g. Tailscale Funnel not yet approved on the tailnet)
    // must NOT leave the gateway tunnel-less when another installed provider
    // could work. localtunnel is excluded from automatic fallback because its
    // start path retries for minutes — it only runs when explicitly chosen.
    const fallbackOrder = ["tailscale", "cloudflared", "ngrok", "serveo"];
    const preferred = cfg.provider;
    const candidates =
      preferred && preferred !== "none"
        ? [preferred, ...fallbackOrder.filter((p) => p !== preferred)]
        : fallbackOrder;

    for (const provider of candidates) {
      if (this.stopped) break;
      if (!(await this.providerAvailable(provider))) continue;
      const info = await this.startProvider(provider, port);
      if (info.status === "running") return info;
      log.warn(`tunnel provider "${provider}" did not start (${info.error ?? "unknown error"}); trying next provider`);
    }

    this.info = {
      provider: "none",
      status: "error",
      error:
        "No tunnel provider could start. Install Tailscale, cloudflared, or ngrok, or set tunnel.publicUrl in config to a public HTTPS URL.",
    };
    return this.info;
  }

  /** Whether a provider's binary/runtime is present so it's worth attempting. */
  private async providerAvailable(provider: string): Promise<boolean> {
    switch (provider) {
      case "tailscale":
        return (await resolveTailscale()) !== null;
      case "cloudflared":
        return commandExists("cloudflared");
      case "ngrok":
        return commandExists("ngrok");
      case "localtunnel":
        return true; // launched on demand via npx
      case "serveo":
        return commandExists("ssh");
      default:
        return false;
    }
  }

  private startProvider(provider: string, port: number): Promise<TunnelInfo> {
    switch (provider) {
      case "tailscale":
        return this.startTailscale(port);
      case "cloudflared":
        return this.startCloudflared(port);
      case "ngrok":
        return this.startNgrok(port);
      case "localtunnel":
        return this.startLocaltunnel(port);
      case "serveo":
        return this.startServeo(port);
      default:
        return Promise.resolve({ provider: "none", status: "error", error: `Unknown tunnel provider "${provider}".` });
    }
  }

  private async startTailscale(port: number): Promise<TunnelInfo> {
    const bin = (await resolveTailscale()) ?? "tailscale";
    const env = tailscaleEnv();
    // Funnel serves publicly on port 443 and only one serve/funnel config can
    // own it. A leftover config (e.g. a prior `--bg` funnel pointing elsewhere)
    // makes the foreground `funnel <port>` fail with "listener already exists
    // for port 443". Best-effort clear it first so we cleanly claim the port.
    await execFileSafe(bin, ["funnel", "reset"], { timeoutMs: 10_000, env });
    return new Promise((resolve) => {
      this.info = { provider: "tailscale", status: "starting" };
      const cfg = this.config().tunnel;
      const child = spawn(bin, ["funnel", String(port)], { shell: false, env });
      this.child = child;

      const onData = (buf: Buffer) => {
        const text = buf.toString("utf8");
        const m = text.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net/i);
        if (m && this.info.status !== "running") {
          this.info = { provider: "tailscale", url: m[0], status: "running" };
          this.clearTunnelTimeout();
          resolve(this.info);
        }
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => {
        this.info = { provider: "tailscale", status: "error", error: e.message };
        this.clearTunnelTimeout();
        resolve(this.info);
      });
      child.on("close", (code) => {
        if (this.stopped || this.info.status === "running") return;
        this.info = {
          provider: "tailscale",
          status: "error",
          error:
            `Tailscale Funnel exited before publishing a URL${code === null ? "" : ` (exit ${code})`}. ` +
            "Run `tailscale funnel <port>` once to approve Funnel for this tailnet, or set tunnel.domain / tunnel.publicUrl.",
        };
        this.clearTunnelTimeout();
        resolve(this.info);
      });
      this.timeoutId = setTimeout(() => {
        if (this.info.status !== "running") {
          if (cfg.domain) {
            this.info = { provider: "tailscale", url: cfg.publicUrl || `https://${cfg.domain}`, status: "running" };
          } else {
            this.info = {
              provider: "tailscale",
              status: "error",
              error: "Timed out waiting for Tailscale Funnel URL. Check `tailscale funnel status` or set tunnel.domain.",
            };
          }
          resolve(this.info);
        }
      }, 20_000);
    });
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
      const child = spawn(resolveExecutable("cloudflared"), args, { shell: false });
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
      this.timeoutId = setTimeout(() => {
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
      const child = spawn(resolveExecutable("ngrok"), args, { shell: false });
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
      this.timeoutId = setTimeout(() => {
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
      this.timeoutId = setTimeout(() => {
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
    // Resolve the caller's promise exactly once on first outcome, then keep the
    // tunnel alive in the background by reconnecting if the ssh process dies.
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve(this.info);
      };
      this.spawnServeo(port, settle);
    });
  }

  /**
   * Spawn the serveo ssh tunnel and wire up its handlers. On unexpected exit
   * (network drop, serveo restart, idle timeout) it schedules a reconnect so a
   * long-running gateway never ends up alive-but-unreachable. `settle` is
   * invoked once the first connection result is known.
   */
  private spawnServeo(port: number, settle: () => void): void {
    if (this.stopped) return;
    this.info = { provider: "serveo", status: "starting" };
    const cfg = this.config().tunnel;
    const subdomain = cfg.subdomain ? `${cfg.subdomain}:` : "";
    const args = [
      "-R",
      `${subdomain}80:127.0.0.1:${port}`,
      "-o",
      "StrictHostKeyChecking=no",
      // Detect dead connections quickly and exit so we can reconnect.
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "ExitOnForwardFailure=yes",
      "serveo.net",
    ];
    const child = spawn("ssh", args, { shell: false });
    this.child = child;
    // A fatal config error (subdomain taken / key not registered) must not be
    // retried in a tight loop — only transient drops should reconnect.
    let fatal = false;

    const onData = (buf: Buffer) => {
      const text = buf.toString("utf8");

      // ポートフォワーディング失敗を検出
      if (text.includes("remote port forwarding failed") && this.info.status !== "error") {
        log.warn("Serveo port forwarding failed. Subdomain might be in use.");
        fatal = true;
        this.info = {
          provider: "serveo",
          status: "error",
          error: "Serveo port forwarding failed. Subdomain might be in use. Please try restarting the tunnel in a few seconds.",
        };
        this.clearTunnelTimeout();
        this.killChild();
        settle();
        return;
      }

      // 固定サブドメインの利用には SSH 公開鍵の登録が必要。未登録だと毎回ランダムな
      // ホストが割り当てられ、再起動のたびに URL が変わってしまう（ChatGPT コネクタが壊れる）。
      // 登録用 URL を添えてエラーにし、ユーザーに一度きりの登録を促す。
      if (
        cfg.subdomain &&
        /register your SSH public key/i.test(text) &&
        this.info.status !== "running" &&
        this.info.status !== "error"
      ) {
        const consoleUrl = text.match(/https:\/\/console\.serveo\.net\/ssh\/keys\?add=\S+/i)?.[0];
        fatal = true;
        this.info = {
          provider: "serveo",
          status: "error",
          error:
            `Serveo requires a one-time SSH key registration to reserve the fixed subdomain "${cfg.subdomain}". ` +
            (consoleUrl
              ? `Open ${consoleUrl} and sign in with Google/GitHub, then restart the tunnel.`
              : "Visit https://console.serveo.net/ssh/keys and register your SSH public key, then restart the tunnel."),
        };
        this.clearTunnelTimeout();
        settle();
        return;
      }

      // Serveo が出力する転送 URL をそのまま使う。実際の公開ホストは
      // <subdomain>.serveousercontent.com で、ここを .serveo.net に書き換えると
      // 警告ページ (302) に飛んでしまい /healthz が到達不能になる。
      const m = text.match(/Forwarding HTTP traffic from (https:\/\/\S+)/i);
      if (m && this.info.status !== "running" && this.info.status !== "error") {
        this.info = { provider: "serveo", url: m[1], status: "running" };
        this.clearTunnelTimeout();
        settle();
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => {
      this.info = { provider: "serveo", status: "error", error: e.message };
      settle();
    });
    child.on("close", () => {
      if (this.stopped || fatal) return;
      // The ssh process exited unexpectedly while we should be serving — the
      // gateway is still up, so reconnect to restore the public URL.
      log.warn("Serveo tunnel dropped; reconnecting in 3s…");
      this.child = undefined;
      this.reconnectTimer = setTimeout(() => this.spawnServeo(port, settle), 3000);
    });

    this.clearTunnelTimeout();
    this.timeoutId = setTimeout(() => {
      if (this.info.status !== "running" && this.info.status !== "error") {
        if (cfg.subdomain) {
          this.info = {
            provider: "serveo",
            url: cfg.publicUrl || `https://${cfg.subdomain}.serveousercontent.com`,
            status: "running",
          };
          settle();
        } else {
          this.info = { provider: "serveo", status: "error", error: "Timed out waiting for serveo URL." };
          settle();
        }
      }
    }, 20_000);
  }

  private clearTunnelTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }

  private killChild(): void {
    if (!this.child) return;
    try {
      this.child.stdout?.removeAllListeners();
      this.child.stderr?.removeAllListeners();
      this.child.removeAllListeners();
      this.child.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.child = undefined;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.clearTunnelTimeout();
    if (this.child) {
      log.info("stopping tunnel");
      this.killChild();
    }
    this.info = { provider: this.info.provider, status: "stopped" };
  }
}
