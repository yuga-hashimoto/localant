import { spawn } from "node:child_process";
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

/**
 * Ask a yes/no question on the terminal. When stdin is not a TTY (piped,
 * CI, background run) the prompt is skipped and `def` is returned, so
 * non-interactive invocations never hang.
 */
export function promptYesNo(question: string, def = false): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(def);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${def ? "[Y/n]" : "[y/N]"} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") return resolve(def);
      resolve(a === "y" || a === "yes");
    });
  });
}

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
