import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { c, ok, warn, openBrowser } from "./util.js";

/** Candidate default SSH public keys, in the order ssh itself prefers them. */
const SSH_PUBKEYS = ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"];

function sshDir(): string {
  return path.join(os.homedir(), ".ssh");
}

/** Returns the first existing default SSH public key path, or undefined. */
function findSshPublicKey(): string | undefined {
  for (const name of SSH_PUBKEYS) {
    const p = path.join(sshDir(), name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Ensure an SSH key pair exists. If none is present, generate a passphrase-less
 * ed25519 key non-interactively. Returns the public key path.
 */
function ensureSshKey(): string {
  const existing = findSshPublicKey();
  if (existing) return existing;

  const dir = sshDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, "id_ed25519");
  // -N "" = no passphrase, -q = quiet. execFileSync avoids shell injection.
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-q"], { stdio: "ignore" });
  console.log(ok(`Generated SSH key: ${keyPath}.pub`));
  return `${keyPath}.pub`;
}

export interface ServeoCheck {
  /** True when the requested fixed subdomain was granted (key is registered). */
  registered: boolean;
  /** Pre-filled registration URL serveo prints for unregistered keys. */
  consoleUrl?: string;
  /** The forwarding URL serveo assigned (fixed if registered, random if not). */
  url?: string;
}

/**
 * Parse accumulated serveo SSH banner output into a registration verdict.
 * Returns null until the decisive "Forwarding HTTP traffic from …" line (always
 * emitted last) has arrived, so callers can keep buffering. Pure + synchronous
 * to keep the spawn logic thin and unit-testable.
 */
export function parseServeoBanner(acc: string, subdomain: string): ServeoCheck | null {
  const fwd = acc.match(/Forwarding HTTP traffic from (https:\/\/\S+)/i);
  if (!fwd || !fwd[1]) return null;
  const url = fwd[1];
  const consoleUrl = acc.match(/https:\/\/console\.serveo\.net\/ssh\/keys\?add=\S+/i)?.[0];
  const needsRegistration = /register your SSH public key/i.test(acc);
  const host = url.replace(/^https:\/\//, "");
  const registered = !needsRegistration && host.startsWith(`${subdomain}.`);
  return { registered, consoleUrl, url };
}

/**
 * Open a short-lived serveo SSH tunnel and inspect its banner to determine
 * whether the SSH key is registered (fixed subdomain granted) or not. Never
 * leaves a process behind — the child is always killed before resolving.
 */
export function checkServeoRegistration(subdomain: string, port: number, timeoutMs = 15000): Promise<ServeoCheck> {
  return new Promise((resolve) => {
    const args = [
      "-R",
      `${subdomain}:80:127.0.0.1:${port}`,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=10",
      "serveo.net",
    ];
    const child = spawn("ssh", args, { shell: false });
    let acc = "";
    let done = false;
    const finish = (r: ServeoCheck) => {
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
      resolve(r);
    };

    const onData = (buf: Buffer) => {
      acc += buf.toString("utf8");
      // The "Forwarding HTTP traffic from …" line is emitted last in both the
      // registered and unregistered cases, so once we see it the accumulated
      // buffer already contains the registration notice + console URL (if any).
      const verdict = parseServeoBanner(acc, subdomain);
      if (verdict) finish(verdict);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", () => finish({ registered: false }));
    const timer = setTimeout(() => {
      const consoleUrl = acc.match(/https:\/\/console\.serveo\.net\/ssh\/keys\?add=\S+/i)?.[0];
      finish({ registered: false, consoleUrl });
    }, timeoutMs);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Make sure the user's SSH key is registered with Serveo so the configured
 * fixed subdomain is granted on every restart.
 *
 * - If a key is already registered, returns immediately (no prompts).
 * - Otherwise generates a key if needed, shows it, opens the pre-filled
 *   registration page, and polls until the user completes the one-time
 *   browser login — then continues automatically.
 *
 * Returns true if registration is confirmed, false if the user should proceed
 * without a guaranteed fixed URL (timeout / opted out).
 */
export async function ensureServeoRegistration(
  subdomain: string,
  port: number,
  opts: { noOpen?: boolean } = {},
): Promise<boolean> {
  const pubKeyPath = ensureSshKey();

  process.stdout.write(c.gray("Checking Serveo SSH key registration… "));
  const first = await checkServeoRegistration(subdomain, port);
  if (first.registered) {
    process.stdout.write(c.green("already registered\n"));
    console.log(ok(`Fixed URL ready: ${c.cyan(`https://${subdomain}.serveousercontent.com`)}`));
    return true;
  }
  process.stdout.write(c.yellow("not registered\n"));

  const consoleUrl =
    first.consoleUrl ?? "https://console.serveo.net/ssh/keys";
  const pubKey = (() => {
    try {
      return fs.readFileSync(pubKeyPath, "utf8").trim();
    } catch {
      return "(unable to read public key)";
    }
  })();

  console.log("");
  console.log(c.bold("One-time Serveo SSH key registration (needed for a permanent URL):"));
  console.log(`  1. A browser will open ${c.cyan("console.serveo.net")} (your key is pre-filled).`);
  console.log("  2. Sign in with Google or GitHub and confirm adding the key.");
  console.log(c.gray("     Your public key:"));
  console.log(c.gray(`       ${pubKey}`));
  console.log(c.gray(`     Registration URL: ${consoleUrl}`));
  console.log("");

  if (!opts.noOpen) openBrowser(consoleUrl);

  // Poll until serveo grants the fixed subdomain. ~2 min budget, zero typing.
  const maxAttempts = 24;
  const intervalMs = 5000;
  process.stdout.write(c.gray("Waiting for registration to complete"));
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    process.stdout.write(c.gray("."));
    const check = await checkServeoRegistration(subdomain, port);
    if (check.registered) {
      process.stdout.write(c.green(" done\n"));
      console.log(ok(`SSH key registered. Fixed URL: ${c.cyan(`https://${subdomain}.serveousercontent.com`)}`));
      return true;
    }
  }

  process.stdout.write(c.yellow(" timed out\n"));
  console.log(
    warn(
      "Registration not detected yet. The tunnel will still start, but the URL may " +
        "change until you finish registering. Re-run `localant setup` after registering, " +
        `or open ${consoleUrl} manually.`,
    ),
  );
  return false;
}
