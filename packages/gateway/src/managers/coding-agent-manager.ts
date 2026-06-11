import { spawn, type ChildProcess } from "node:child_process";
import { nanoid } from "nanoid";
import type { CodingAgentConfig, Config } from "@localant/shared";
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
}

/**
 * Drives local AI coding agents (Claude Code, Codex, custom). Plans are
 * non-mutating; execution requires approval upstream, creates a work branch,
 * and is followed by validation + diff review. Tasks operate directly on a
 * working-directory path — no project registration is required.
 */
export class CodingAgentManager {
  private readonly tasks = new Map<string, RunningTask>();

  constructor(
    private readonly config: () => Config,
    private readonly git: GitManager,
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
    const isYolo = this.config().security.mode === "yolo";
    const args = [...cfg.args, ...cfg.planArgs, ...(isYolo ? cfg.dangerArgs : []), prompt];
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
    opts: { createBranch?: boolean; branchName?: string } = {},
  ): Promise<{ taskId: string; branch?: string; warning?: string }> {
    const cfg = this.agentConfig(agent);
    if (!cfg.enabled) throw new Error(`Agent '${agent}' is disabled in config.`);
    if (!(await commandExists(cfg.command))) throw new Error(`Agent binary '${cfg.command}' not found on PATH.`);

    let warning: string | undefined;
    if (await this.git.isDirty(cwd)) {
      warning = "Working tree was dirty before the task started. Existing changes may be mixed in.";
    }

    let branch: string | undefined;
    if (opts.createBranch !== false) {
      branch = opts.branchName ?? `cla/${agent}-${Date.now()}`;
      await this.git.createBranch(cwd, branch);
    }

    const id = nanoid(8);
    const prompt = `Implement the following task. Run tests/validation when done.\n\n${task}`;
    const isYolo = this.config().security.mode === "yolo";
    const args = [...cfg.args, ...cfg.executeArgs, ...(isYolo ? cfg.dangerArgs : []), prompt];
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

  /** All tasks (most recent first), without child handles or logs. */
  listTasks() {
    return [...this.tasks.values()]
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
    };
  }

  getLogs(id: string): string {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return t.logs;
  }

  stopTask(id: string) {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    t.child?.kill("SIGTERM");
    t.status = "stopped";
    return { id, stopped: true };
  }

  async continueTask(id: string, task: string): Promise<{ taskId: string; branch?: string }> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return this.startTask(t.agent, t.cwd, task, { createBranch: false });
  }

  async getDiff(id: string): Promise<string> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return this.git.diff(t.cwd);
  }

  async runValidation(cwd: string, command: string): Promise<{ command: string; code: number | null; output: string }> {
    if (!command) throw new Error("No validate/test command provided.");
    const [file, ...args] = command.split(" ");
    const res = await execFileSafe(file!, args, { cwd, timeoutMs: 300_000, maxOutputBytes: 200_000 });
    return { command, code: res.code, output: (res.stdout + res.stderr).slice(0, 50_000) };
  }
}
