import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  green: wrap(32),
  red: wrap(31),
  yellow: wrap(33),
  cyan: wrap(36),
  gray: wrap(90),
  bold: wrap(1),
};

export const ok = (s: string) => `${c.green("✅")} ${s}`;
export const warn = (s: string) => `${c.yellow("⚠️ ")} ${s}`;
export const fail = (s: string) => `${c.red("✖")} ${s}`;

/** Copy text to the clipboard using the platform tool. Best-effort. */
export function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
    const args = process.platform === "linux" ? ["-selection", "clipboard"] : [];
    try {
      const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      child.stdin.write(text);
      child.stdin.end();
    } catch {
      resolve(false);
    }
  });
}

/** Open a URL in the default browser. Best-effort. */
export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* ignore */
  }
}

/** Tiny ASCII QR-ish box (not a scannable QR; a visual marker + URL). */
export function urlBox(url: string): string {
  const line = "─".repeat(Math.min(url.length, 60) + 2);
  return `┌${line}┐\n│ ${url} │\n└${line}┘`;
}

/** Ensure the user has an SSH key pair for serveo tunnel. If not, generate one. */
export function ensureSshKey(): Promise<void> {
  return new Promise((resolve) => {
    const home = os.homedir();
    const sshDir = path.join(home, ".ssh");
    const keyFiles = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];

    if (fs.existsSync(sshDir)) {
      try {
        const files = fs.readdirSync(sshDir);
        const hasKey = files.some((file) => keyFiles.includes(file));
        if (hasKey) {
          return resolve();
        }
      } catch {
        // ignore read error and try to generate
      }
    } else {
      try {
        fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        console.log(warn(`Failed to create directory ${sshDir}: ${(err as Error).message}`));
      }
    }

    console.log(c.gray("SSH key not found. Generating a new one for serveo tunnel…"));
    const keyPath = path.join(sshDir, "id_ed25519");
    const child = spawn("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath], { stdio: "inherit" });

    child.on("error", (err) => {
      console.log(warn(`Could not start ssh-keygen: ${err.message}`));
      console.log(warn("If you plan to use the serveo tunnel, please run 'ssh-keygen' manually."));
      resolve();
    });

    child.on("close", async (code) => {
      if (code === 0) {
        console.log(ok("SSH key generated successfully at ~/.ssh/id_ed25519"));

        try {
          const pubKeyPath = `${keyPath}.pub`;
          const fingerprintOutput = execSync(`ssh-keygen -lf "${pubKeyPath}"`, { encoding: "utf8" });
          const m = fingerprintOutput.match(/SHA256:([^\s]+)/);
          if (m) {
            const fingerprint = `SHA256:${m[1]}`;
            const registerUrl = `https://console.serveo.net/ssh/keys?add=${encodeURIComponent(fingerprint)}`;

            console.log("\n" + c.bold("🔑 Action Required: Register SSH Key with Serveo"));
            console.log(c.cyan(`To request custom subdomains, serveo.net requires SSH key registration.`));
            console.log(c.cyan(`Opening registration page in your default browser:`));
            console.log(`  ${registerUrl}\n`);

            openBrowser(registerUrl);

            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            await new Promise<void>((res) => {
              rl.question(c.bold("Press [Enter] after you have registered the key to continue..."), () => {
                rl.close();
                res();
              });
            });
            console.log(ok("Continuing setup…\n"));
          }
        } catch (err) {
          console.log(warn(`Could not determine SSH fingerprint: ${(err as Error).message}`));
        }
      } else {
        console.log(warn(`ssh-keygen exited with code ${code}`));
        console.log(warn("If you plan to use the serveo tunnel, please run 'ssh-keygen' manually."));
      }
      resolve();
    });
  });
}

