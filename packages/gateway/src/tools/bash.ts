import { z } from "zod";
import type { Gateway } from "../gateway.js";
import { commandExists } from "../util/exec.js";

/**
 * The `bash` tool: run an arbitrary command through a real shell, but only
 * after CommandGuard rejects blocked tokens / `rm -rf` and PathGuard validates
 * `cwd`. Risk 3, so the gateway's mode policy gates it: approval in strict,
 * ungated (but audited) in open, ungated in yolo — and CORE_BLOCKED_COMMAND_TOKENS
 * are rejected even in yolo.
 */
export function registerBashTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "bash",
    description:
      "Run a shell command (bash -c) inside an allowed directory. Pipelines and && chaining work. Blocked commands (sudo, rm -rf, dd, mkfs, …) are always rejected. Risk 3.",
    risk: 3,
    inputSchema: z.object({
      command: z.string(),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().min(1).max(1_800_000).optional(),
      maxOutputBytes: z.number().int().min(1).max(10_000_000).optional(),
      reason: z.string().optional(),
    }),
    summarize: (i) => `bash: ${i.command.slice(0, 80)}`,
    handler: (i) =>
      gw.shell.runBash(i.command, {
        cwd: i.cwd,
        timeoutMs: i.timeoutMs,
        maxOutputBytes: i.maxOutputBytes,
      }),
  });

  r.register({
    name: "shell_run_background",
    description: "Start a long-running command as a tracked background process. Returns a processId.",
    risk: 3,
    inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
    summarize: (i) => `bg: ${i.command.slice(0, 80)}`,
    handler: (i) => {
      const id = gw.shell.startProcess(i.command, i.cwd);
      return { processId: id, command: i.command, status: "running" };
    },
  });

  r.register({
    name: "shell_get_output",
    description: "Get captured stdout/stderr/status for a tracked background process.",
    risk: 0,
    inputSchema: z.object({ processId: z.string() }),
    handler: (i) => {
      const o = gw.shell.getOutput(i.processId);
      return { processId: o.id, status: o.status, exitCode: o.exitCode, stdout: o.stdout, stderr: o.stderr };
    },
  });

  r.register({
    name: "shell_stop",
    description: "Stop a tracked background process.",
    risk: 2,
    inputSchema: z.object({ processId: z.string() }),
    summarize: (i) => `stop ${i.processId}`,
    handler: (i) => gw.shell.stopProcess(i.processId),
  });

  r.register({
    name: "command_exists",
    description: "Check whether a binary is resolvable on PATH.",
    risk: 0,
    inputSchema: z.object({ command: z.string() }),
    handler: async (i) => ({ command: i.command, exists: await commandExists(i.command) }),
  });
}
