import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a program with explicit argv (no shell) so user input is never
 * interpreted by a shell. Output is capped at maxOutputBytes.
 */
export function execFileSafe(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const { cwd, timeoutMs = 120_000, maxOutputBytes = 100_000, input, env } = opts;
  return new Promise((resolve) => {
    // When no input is supplied, give the child /dev/null for stdin. A spawned
    // process has no TTY, and an open-but-empty stdin pipe makes interactive
    // CLIs (e.g. coding agents) hang waiting for input that never reaches EOF.
    const stdin = input !== undefined ? "pipe" : "ignore";
    const child = spawn(file, args, { cwd, env: env ?? process.env, shell: false, stdio: [stdin, "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < maxOutputBytes) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < maxOutputBytes) stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + `\n${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.slice(0, maxOutputBytes),
        stderr: stderr.slice(0, maxOutputBytes),
        timedOut,
      });
    });
    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/** Check whether a binary is resolvable on PATH. */
export async function commandExists(cmd: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  const res = await execFileSafe(probe, [cmd], { timeoutMs: 5000 });
  return res.code === 0 && res.stdout.trim().length > 0;
}
