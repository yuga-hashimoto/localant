import { spawn, type ChildProcess } from "node:child_process";
import { nanoid } from "nanoid";
import type { Config } from "@localant/shared";
import { CommandGuard, parseCommand } from "../security/command-guard.js";
import { PathGuard } from "../security/path-guard.js";
import { execFileSafe } from "../util/exec.js";

interface ManagedProcess {
  id: string;
  command: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  startedAt: string;
  exitCode: number | null;
  status: "running" | "exited";
}

/**
 * Executes commands with no shell interpretation: the validated command is
 * split into argv and run directly. Long-running processes are tracked so
 * they can be polled and stopped.
 */
export class ShellManager {
  private readonly processes = new Map<string, ManagedProcess>();

  constructor(
    private readonly guard: CommandGuard,
    private readonly pathGuard: PathGuard,
    private readonly config: () => Config,
  ) {}

  private resolveCwd(cwd?: string): string {
    if (!cwd) return this.pathGuard.allowed()[0] ?? process.cwd();
    return this.pathGuard.assertAccess(cwd, "read");
  }

  async runAllowed(command: string, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const normalized = this.guard.assertAllowed(command);
    return this.runArgv(normalized, cwd);
  }

  async runApproved(command: string, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const normalized = this.guard.assertNotBlocked(command);
    return this.runArgv(normalized, cwd);
  }

  /**
   * Run an arbitrary command through a real shell (`bash -c`) so pipelines,
   * redirection and `&&` chaining work — but only after CommandGuard has
   * rejected blocked tokens / `rm -rf` across every pipeline segment, and after
   * PathGuard has validated `cwd`. Output is capped and the call is timed.
   */
  async runBash(
    command: string,
    opts: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number } = {},
  ): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    command: string;
    cwd: string;
    durationMs: number;
    timedOut: boolean;
  }> {
    const normalized = this.guard.assertNotBlocked(command);
    const cwd = this.resolveCwd(opts.cwd);
    const sec = this.config().security;
    const shell = process.platform === "win32" ? "cmd" : "bash";
    const shellArgs = process.platform === "win32" ? ["/c", normalized] : ["-c", normalized];
    const started = Date.now();
    const res = await execFileSafe(shell, shellArgs, {
      cwd,
      timeoutMs: opts.timeoutMs ?? sec.commandTimeoutMs,
      maxOutputBytes: opts.maxOutputBytes ?? sec.maxOutputBytes,
    });
    return {
      code: res.code,
      stdout: res.stdout,
      stderr: res.stderr,
      command: normalized,
      cwd,
      durationMs: Date.now() - started,
      timedOut: res.timedOut,
    };
  }

  private async runArgv(normalized: string, cwd?: string) {
    const { tokens } = parseCommand(normalized);
    const [file, ...args] = splitArgs(normalized);
    if (!file) throw new Error("Empty command.");
    void tokens;
    const sec = this.config().security;
    const res = await execFileSafe(file, args, {
      cwd: this.resolveCwd(cwd),
      timeoutMs: sec.commandTimeoutMs,
      maxOutputBytes: sec.maxOutputBytes,
    });
    return { code: res.code, stdout: res.stdout, stderr: res.stderr };
  }

  /**
   * Spawn a long-running approved process and track it. Runs through a real
   * shell (`bash -c`, `cmd /c` on Windows) so pipelines, redirection and `&&`
   * chaining behave the same as the foreground `bash` tool — but only after
   * CommandGuard rejects blocked tokens across every pipeline segment.
   */
  startProcess(command: string, cwd?: string): string {
    const normalized = this.guard.assertNotBlocked(command);
    const shell = process.platform === "win32" ? "cmd" : "bash";
    const shellArgs = process.platform === "win32" ? ["/c", normalized] : ["-c", normalized];
    const child = spawn(shell, shellArgs, { cwd: this.resolveCwd(cwd), shell: false });
    const id = nanoid(8);
    const proc: ManagedProcess = {
      id,
      command: normalized,
      child,
      stdout: "",
      stderr: "",
      startedAt: new Date().toISOString(),
      exitCode: null,
      status: "running",
    };
    const cap = this.config().security.maxOutputBytes;
    child.stdout?.on("data", (d: Buffer) => {
      if (proc.stdout.length < cap) proc.stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (proc.stderr.length < cap) proc.stderr += d.toString("utf8");
    });
    child.on("close", (code) => {
      proc.exitCode = code;
      proc.status = "exited";
    });
    this.processes.set(id, proc);
    return id;
  }

  listProcesses() {
    return [...this.processes.values()].map((p) => ({
      id: p.id,
      command: p.command,
      status: p.status,
      exitCode: p.exitCode,
      startedAt: p.startedAt,
    }));
  }

  getOutput(id: string) {
    const p = this.processes.get(id);
    if (!p) throw new Error(`Process not found: ${id}`);
    return { id, status: p.status, exitCode: p.exitCode, stdout: p.stdout, stderr: p.stderr };
  }

  stopProcess(id: string) {
    const p = this.processes.get(id);
    if (!p) throw new Error(`Process not found: ${id}`);
    p.child.kill("SIGTERM");
    return { id, stopped: true };
  }
}

/** Split a normalized command string into argv, honoring simple quoting. */
function splitArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " ") {
      if (current) args.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}
