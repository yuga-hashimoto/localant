import { spawn, execFileSync } from "node:child_process";
import { resolveTailscale } from "@localant/gateway";
import { c, ok, warn, openBrowser, promptYesNo } from "./util.js";

/** Daemon backend state, narrowed to what onboarding needs to decide. */
type TsState = "running" | "needs-login" | "stopped" | "unknown";

/** Read the Tailscale daemon's BackendState. "unknown" on any failure. */
function backendState(bin: string): TsState {
  try {
    const out = execFileSync(bin, ["status", "--json"], {
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const state = String((JSON.parse(out) as { BackendState?: string }).BackendState ?? "");
    if (state === "Running") return "running";
    if (state === "Stopped") return "stopped";
    if (state === "NeedsLogin" || state === "NoState") return "needs-login";
    return "unknown";
  } catch {
    return "unknown";
  }
}

interface FunnelProbe {
  /** A working public Funnel URL, when Funnel is already usable. */
  url?: string;
  /** A page to open when Funnel must first be enabled on the tailnet. */
  enableUrl?: string;
}

/**
 * Attempt a short-lived Funnel to learn whether it is usable on this tailnet.
 * Resets any leftover 443 config first so the probe binds cleanly, then kills
 * the child before resolving — never leaves a process or funnel behind.
 */
function probeFunnel(bin: string, port: number, timeoutMs = 12000): Promise<FunnelProbe> {
  return new Promise((resolve) => {
    try {
      execFileSync(bin, ["funnel", "reset"], { timeout: 8000, stdio: "ignore" });
    } catch {
      // best-effort; the probe spawn below surfaces real failures
    }
    const child = spawn(bin, ["funnel", String(port)], { shell: false });
    let acc = "";
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.removeAllListeners();
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      const url = acc.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net/i)?.[0];
      const enableUrl =
        acc.match(/https:\/\/login\.tailscale\.com\/\S+/i)?.[0] ??
        acc.match(/https:\/\/tailscale\.com\/kb\/\S+/i)?.[0];
      resolve({ url, enableUrl });
    };
    const onData = (buf: Buffer): void => {
      acc += buf.toString("utf8");
      if (/\.ts\.net/i.test(acc)) finish();
      else if (/funnel/i.test(acc) && /(not enabled|not allowed|denied|permission|enable|HTTPS)/i.test(acc)) finish();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", () => finish());
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Guide a first-time user through the Tailscale Funnel prerequisites so the
 * default tunnel "just works": install → login → enable Funnel. Returns true
 * when Funnel is confirmed usable. Returns false (with actionable guidance) at
 * the first unmet step — the gateway then falls back to cloudflared for now.
 *
 * Returning users who are already set up hit only the fast Funnel probe and see
 * a single "ready" line with no prompts.
 */
export async function ensureTailscaleSetup(port: number, opts: { noOpen?: boolean } = {}): Promise<string | null> {
  const bin = await resolveTailscale();

  // 1. Installed?
  if (!bin) {
    console.log("");
    console.log(warn("Tailscale isn't installed — it's the default tunnel (stable URL, no time-cap)."));
    console.log("  Install it once:");
    if (process.platform === "darwin") {
      console.log(c.gray("    • brew install --cask tailscale   (or the Mac App Store)"));
    } else if (process.platform === "linux") {
      console.log(c.gray("    • curl -fsSL https://tailscale.com/install.sh | sh"));
    }
    console.log(c.gray("    • or download: https://tailscale.com/download"));
    console.log(c.gray("  Then re-run `localant setup`. (LocalAnt uses cloudflared until then.)"));
    return null;
  }

  // 2. Logged in / daemon up?
  let state = backendState(bin);
  if (state !== "running") {
    console.log("");
    console.log(warn("Tailscale is installed but not logged in / connected."));
    if (bin.includes("Tailscale.app")) {
      // macOS GUI build: login is driven from the menu-bar app, not the CLI.
      console.log("  Open the Tailscale app (menu bar) and sign in, then re-run `localant setup`.");
      if (!opts.noOpen) {
        try {
          spawn("open", ["-a", "Tailscale"], { stdio: "ignore", detached: true }).unref();
        } catch {
          /* ignore */
        }
      }
      return null;
    }
    const go = await promptYesNo("Log in to Tailscale now? (opens a browser)", true);
    if (!go) {
      console.log(c.gray("  Skipped. Run `tailscale up`, then re-run `localant setup`."));
      return null;
    }
    try {
      console.log(c.gray("  Running `tailscale up` — complete the login in your browser…"));
      execFileSync(bin, ["up"], { stdio: "inherit", timeout: 180_000 });
    } catch {
      // user cancelled or it timed out — re-checked below
    }
    state = backendState(bin);
    if (state !== "running") {
      console.log(warn("Still not logged in. Re-run `localant setup` after logging in."));
      return null;
    }
  }
  console.log(ok("Tailscale logged in."));

  // 3. Funnel enabled on the tailnet?
  process.stdout.write(c.gray("Checking Tailscale Funnel… "));
  const probe = await probeFunnel(bin, port);
  if (probe.url) {
    process.stdout.write(c.green("ready\n"));
    console.log(ok(`Funnel URL: ${c.cyan(`${probe.url}/mcp`)}`));
    const domain = probe.url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return domain;
  }
  process.stdout.write(c.yellow("not enabled\n"));
  console.log("");
  console.log(c.bold("One-time: enable Funnel for your tailnet"));
  console.log("  Funnel must be allowed in your tailnet policy (HTTPS + the funnel node attribute).");
  const enableUrl = probe.enableUrl ?? "https://tailscale.com/kb/1223/funnel#requirements";
  console.log(c.gray(`  Open: ${enableUrl}`));
  if (!opts.noOpen) openBrowser(enableUrl);
  console.log(c.gray("  After enabling, run `localant restart`. (cloudflared is used until then.)"));
  return null;
}
