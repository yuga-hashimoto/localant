import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** launchd label for the LocalAnt gateway LaunchAgent. */
const LABEL = "com.localant.gateway";

function launchAgentsDir(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

function plistPath(): string {
  return path.join(launchAgentsDir(), `${LABEL}.plist`);
}

/** Auto-start on login is currently implemented for macOS (launchd) only. */
export function autostartSupported(): boolean {
  return process.platform === "darwin";
}

/** True when the LaunchAgent plist is installed. */
export function isAutostartEnabled(): boolean {
  return autostartSupported() && fs.existsSync(plistPath());
}

/**
 * A PATH for the launchd job. launchd starts with a minimal PATH, but the
 * gateway shells out to ssh / node / npx / cloudflared, so we seed it with the
 * common locations plus whatever PATH setup itself was launched with.
 */
function launchdPath(): string {
  const base = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const inherited = (process.env.PATH ?? "").split(":").filter(Boolean);
  return [...new Set([...base, ...inherited])].join(":");
}

function buildPlist(logDir: string): string {
  const node = process.execPath;
  const binJs = path.resolve(process.argv[1] ?? "");
  const outLog = path.join(logDir, "autostart.out.log");
  const errLog = path.join(logDir, "autostart.err.log");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(node)}</string>
    <string>${esc(binJs)}</string>
    <string>start</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${esc(os.homedir())}</string>
  <key>StandardOutPath</key>
  <string>${esc(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(errLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${esc(launchdPath())}</string>
  </dict>
</dict>
</plist>
`;
}

/**
 * Install the LaunchAgent so the gateway starts automatically on every login.
 * The plist is written but not booted immediately — booting it now would spawn
 * a second `start` that collides with the gateway setup is about to run on the
 * same port. It takes effect on the next login/reboot. Returns the plist path.
 */
export function enableAutostart(logDir: string): string {
  if (!autostartSupported()) {
    throw new Error("Auto-start on login is only supported on macOS.");
  }
  fs.mkdirSync(launchAgentsDir(), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(plistPath(), buildPlist(logDir), { mode: 0o644 });
  return plistPath();
}

/** Remove the LaunchAgent and stop any running launchd-managed instance. */
export function disableAutostart(): void {
  if (!autostartSupported()) return;
  const p = plistPath();
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid?.()}/${LABEL}`], { stdio: "ignore" });
  } catch {
    // Not loaded — nothing to bootout.
  }
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}
