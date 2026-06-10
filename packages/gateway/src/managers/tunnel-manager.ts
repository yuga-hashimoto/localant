import { spawn, type ChildProcess } from "node:child_process";
import { createLogger, type Config } from "@chatgpt-local-app/shared";
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

  constructor(private readonly config: () => Config) {}

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
    // Fallbacks
    if (await commandExists("cloudflared")) return this.startCloudflared(port);
    if (await commandExists("ngrok")) return this.startNgrok(port);

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
      const child = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`], { shell: false });
      this.child = child;
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
      const child = spawn("ngrok", ["http", String(port), "--log", "stdout"], { shell: false });
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
          this.info = { provider: "ngrok", status: "error", error: "Timed out waiting for ngrok URL." };
          resolve(this.info);
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
