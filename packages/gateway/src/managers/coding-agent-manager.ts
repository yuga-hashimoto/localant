import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { nanoid } from "nanoid";
import type { CodingAgentConfig, Config } from "@localant/shared";
import type { CommandGuard } from "../security/command-guard.js";
import type { PathGuard } from "../security/path-guard.js";
import { commandExists, execFileSafe } from "../util/exec.js";
import type { GitManager } from "./git-manager.js";

interface RunningTask {
  id: string;
  agent: string;
  cwd: string;
  mode: "plan" | "execute";
  task: string;
  status: "running" | "completed" | "failed" | "stopped";
  branch?: string;
  child?: ChildProcess;
  logs: string;
  createdAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  sessionId?: string;
}

/** Token that, when present in an agent's arg list, is replaced by the prompt.
 * When absent, the prompt is appended as the trailing positional argument. */
const PROMPT_PLACEHOLDER = "{{prompt}}";

/**
 * Assemble the final argv for an agent invocation. Most CLIs take the prompt as
 * a trailing positional, so by default the prompt is appended. CLIs that need
 * the prompt in a non-final position (or as a flag value) can place
 * `{{prompt}}` anywhere in their plan/execute/resume args, and every occurrence
 * is substituted instead of appending. This keeps simple agents zero-config
 * while supporting the awkward ones.
 */
export function assembleAgentArgs(base: readonly string[], prompt: string): string[] {
  const hasPlaceholder = base.some((a) => a.includes(PROMPT_PLACEHOLDER));
  if (!hasPlaceholder) return [...base, prompt];
  return base.map((a) => a.split(PROMPT_PLACEHOLDER).join(prompt));
}

/** Resolve a path to its canonical form for use as a repo-lock key. Falls back
 * to the raw path when the directory does not exist yet. */
function repoKey(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/**
 * Drives local AI coding agents (Claude Code, Codex, custom). Plans are
 * non-mutating; execution requires approval upstream, creates a work branch,
 * and is followed by validation + diff review. Tasks operate directly on a
 * working-directory path — no project registration is required.
 */
export class CodingAgentManager {
  private readonly tasks = new Map<string, RunningTask>();
  /** Canonical repo path -> id of the execution task currently holding it.
   * Prevents two chats from running agents against the same working tree at
   * once (which would corrupt branches / diffs). */
  private readonly repoLocks = new Map<string, string>();

  constructor(
    private readonly config: () => Config,
    private readonly git: GitManager,
    private readonly commandGuard: CommandGuard,
    private readonly pathGuard: PathGuard,
  ) {}

  private agentConfig(agent: string): CodingAgentConfig {
    const cfg = this.config().codingAgents[agent];
    if (!cfg) throw new Error(`Unknown coding agent: ${agent}`);
    return cfg;
  }

  async list(): Promise<{ agent: string; enabled: boolean; available: boolean; command: string }[]> {
    const out = [];
    for (const [agent, cfg] of Object.entries(this.config().codingAgents)) {
      out.push({ agent, enabled: cfg.enabled, available: await commandExists(cfg.command), command: cfg.command });
    }
    return out;
  }

  async status(agent: string) {
    const cfg = this.agentConfig(agent);
    return { agent, enabled: cfg.enabled, available: await commandExists(cfg.command), command: cfg.command };
  }

  /** Produce a plan only — no file modification. */
  async plan(agent: string, cwd: string, task: string): Promise<{ taskId: string; output: string }> {
    const cfg = this.agentConfig(agent);
    if (!cfg.enabled) throw new Error(`Agent '${agent}' is disabled in config.`);
    if (!(await commandExists(cfg.command))) {
      throw new Error(`Agent binary '${cfg.command}' not found on PATH.`);
    }
    const prompt = `You are in PLAN MODE. Do NOT modify files. Produce a concise implementation plan for:\n\n${task}`;
    const args = assembleAgentArgs([...cfg.args, ...cfg.planArgs], prompt);
    const res = await execFileSafe(cfg.command, args, {
      cwd,
      timeoutMs: cfg.timeoutMs,
      maxOutputBytes: 200_000,
    });
    const id = nanoid(8);
    this.tasks.set(id, {
      id,
      agent,
      cwd,
      mode: "plan",
      task,
      status: res.code === 0 ? "completed" : "failed",
      logs: res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ""),
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: res.code,
    });
    return { taskId: id, output: res.stdout || res.stderr };
  }

  /** Start an execution task. Creates a work branch first. */
  async startTask(
    agent: string,
    cwd: string,
    task: string,
    opts: { createBranch?: boolean; branchName?: string; sessionId?: string; resume?: boolean } = {},
  ): Promise<{ taskId: string; branch?: string; warning?: string }> {
    const cfg = this.agentConfig(agent);
    if (!cfg.enabled) throw new Error(`Agent '${agent}' is disabled in config.`);
    if (!(await commandExists(cfg.command))) throw new Error(`Agent binary '${cfg.command}' not found on PATH.`);

    // Refuse to run two execution tasks against the same working tree at once.
    // Reserve the lock synchronously, before any `await`, so two concurrent
    // starts can't both pass the check — then release it if setup fails.
    const key = repoKey(cwd);
    const holder = this.repoLocks.get(key);
    if (holder) {
      const other = this.tasks.get(holder);
      const who = other?.sessionId ? ` (session ${other.sessionId})` : "";
      throw new Error(
        `Task ${holder}${who} is already running in this repo (${cwd}). Wait for it to finish or stop it first.`,
      );
    }
    const id = nanoid(8);
    this.repoLocks.set(key, id);

    let warning: string | undefined;
    let branch: string | undefined;
    try {
      if (await this.git.isDirty(cwd)) {
        warning = "Working tree was dirty before the task started. Existing changes may be mixed in.";
      }
      if (opts.createBranch !== false) {
        branch = opts.branchName ?? `cla/${agent}-${Date.now()}`;
        await this.git.createBranch(cwd, branch);
      }
    } catch (e) {
      this.repoLocks.delete(key);
      throw e;
    }

    const prompt = `Implement the following task. Run tests/validation when done.\n\n${task}`;
    const isYolo = this.config().security.mode === "yolo";
    // Resume continues a prior session for turn-based dialogue; fall back to a
    // fresh execute invocation when the agent has no resumeArgs configured.
    const stageArgs = opts.resume && cfg.resumeArgs.length > 0 ? cfg.resumeArgs : cfg.executeArgs;
    const baseArgs = [...cfg.args, ...stageArgs, ...(isYolo ? cfg.dangerArgs : [])];
    const args = assembleAgentArgs(baseArgs, prompt);
    // stdin is /dev/null: spawned agents have no TTY, and an open-but-empty
    // stdin pipe makes interactive CLIs hang waiting for input that never EOFs.
    const child = spawn(cfg.command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const rec: RunningTask = {
      id,
      agent,
      cwd,
      mode: "execute",
      task,
      status: "running",
      branch,
      child,
      logs: "",
      createdAt: new Date().toISOString(),
      sessionId: opts.sessionId,
    };
    const cap = 500_000;
    child.stdout?.on("data", (d: Buffer) => {
      if (rec.logs.length < cap) rec.logs += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (rec.logs.length < cap) rec.logs += d.toString("utf8");
    });
    child.on("close", (code) => {
      rec.exitCode = code;
      rec.status = code === 0 ? "completed" : "failed";
      rec.finishedAt = new Date().toISOString();
      if (this.repoLocks.get(key) === id) this.repoLocks.delete(key);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), cfg.timeoutMs);
    child.on("close", () => clearTimeout(timer));
    this.tasks.set(id, rec);
    return { taskId: id, branch, warning };
  }

  getTask(id: string) {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return this.summarizeTask(t);
  }

  /**
   * Tasks (most recent first), without child handles or logs. When `sessionId`
   * is given, only that session's tasks are returned — so a ChatGPT chat sees
   * its own tasks. Omit it (dashboard / CLI) to see every task.
   */
  listTasks(sessionId?: string) {
    return [...this.tasks.values()]
      .filter((t) => sessionId === undefined || t.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => this.summarizeTask(t));
  }

  private summarizeTask(t: RunningTask) {
    return {
      id: t.id,
      agent: t.agent,
      cwd: t.cwd,
      mode: t.mode,
      task: t.task,
      status: t.status,
      branch: t.branch,
      createdAt: t.createdAt,
      finishedAt: t.finishedAt,
      exitCode: t.exitCode,
      sessionId: t.sessionId,
    };
  }

  getLogs(id: string): string {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return t.logs;
  }

  async stopTask(id: string) {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    const child = t.child;
    if (child) {
      child.kill("SIGTERM");
      // Windows: SIGTERM is not always delivered; fall back to SIGKILL.
      const killed = await new Promise<boolean>((resolve) => {
        const force = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(false);
        }, 500);
        child.on("close", () => {
          clearTimeout(force);
          resolve(true);
        });
      });
      if (!killed) {
        await new Promise<void>((resolve) => child.on("close", () => resolve()));
      }
    }
    t.status = "stopped";
    const key = repoKey(t.cwd);
    if (this.repoLocks.get(key) === id) this.repoLocks.delete(key);
    return { id, stopped: true };
  }

  async continueTask(id: string, task: string): Promise<{ taskId: string; branch?: string }> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    // Reuse the same branch and resume the agent's prior session so ChatGPT can
    // hold a turn-based conversation with the agent.
    return this.startTask(t.agent, t.cwd, task, { createBranch: false, sessionId: t.sessionId, resume: true });
  }

  async getDiff(id: string): Promise<string> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return this.git.diff(t.cwd);
  }

  async runValidation(cwd: string, command: string): Promise<{ command: string; code: number | null; output: string }> {
    if (!command) throw new Error("No validate/test command provided.");
    const safeCwd = this.pathGuard.assertAccess(cwd, "read");
    const normalized = this.commandGuard.assertAllowed(command);
    const [file, ...args] = splitArgs(normalized);
    if (!file) throw new Error("Empty command.");
    const res = await execFileSafe(file, args, { cwd: safeCwd, timeoutMs: 300_000, maxOutputBytes: 200_000 });
    return { command: normalized, code: res.code, output: (res.stdout + res.stderr).slice(0, 50_000) };
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
