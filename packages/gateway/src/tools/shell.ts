import { z } from "zod";
import { nanoid } from "nanoid";
import type { Gateway } from "../gateway.js";

export function registerShellTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "shell_list_allowed_commands",
    description: "List the command prefixes that may be run without approval.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => ({ allowed: gw.commandGuard.allowed(), blocked: gw.config().security.blockedCommandTokens }),
  });

  r.register({
    name: "shell_add_allowed_command",
    description: "Add a command prefix to the allowlist.",
    risk: 2,
    inputSchema: z.object({ command: z.string() }),
    summarize: (i) => `allow command '${i.command}'`,
    handler: (i) => {
      const cfg = gw.config();
      const cmds = Array.from(new Set([...cfg.security.allowedCommands, i.command]));
      gw.saveConfig({ ...cfg, security: { ...cfg.security, allowedCommands: cmds } });
      return { allowed: gw.commandGuard.allowed() };
    },
  });

  r.register({
    name: "shell_remove_allowed_command",
    description: "Remove a command prefix from the allowlist.",
    risk: 2,
    inputSchema: z.object({ command: z.string() }),
    handler: (i) => {
      const cfg = gw.config();
      const cmds = cfg.security.allowedCommands.filter((c) => c !== i.command);
      gw.saveConfig({ ...cfg, security: { ...cfg.security, allowedCommands: cmds } });
      return { allowed: gw.commandGuard.allowed() };
    },
  });

  r.register({
    name: "shell_run_allowed_command",
    description: "Run a command from the allowlist. Pipelines/redirection/chaining are rejected.",
    risk: 1,
    inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
    summarize: (i) => `run '${i.command}'`,
    handler: (i) => gw.shell.runAllowed(i.command, i.cwd),
  });

  r.register({
    name: "shell_request_command_approval",
    description:
      "Request approval to run a command that is NOT on the allowlist. Returns an approval id; once approved, call shell_run_approved_command.",
    risk: 0,
    inputSchema: z.object({ command: z.string(), reason: z.string().default("") }),
    handler: (i, ctx) => {
      const req = gw.approvals.create({
        tool: "shell_run_approved_command",
        risk: 3,
        requirement: "single",
        reason: i.reason || "Run a non-allowlisted command.",
        summary: `run '${i.command}'`,
        caller: ctx.caller,
        sessionId: ctx.sessionId,
      });
      return {
        approvalId: req.id,
        message: `Approval requested. Approve with: localant approvals approve ${req.id}, then call shell_run_approved_command.`,
      };
    },
  });

  r.register({
    name: "shell_run_approved_command",
    description:
      "Run an arbitrary command (still subject to the hard blocklist). Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
    summarize: (i) => `run (approved) '${i.command}'`,
    handler: (i) => gw.shell.runApproved(i.command, i.cwd),
  });

  r.register({
    name: "shell_list_processes",
    description: "List tracked long-running processes.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.shell.listProcesses(),
  });

  r.register({
    name: "shell_get_process_output",
    description: "Get captured output of a tracked process.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => gw.shell.getOutput(i.id),
  });

  r.register({
    name: "shell_stop_process",
    description: "Stop a tracked process.",
    risk: 2,
    inputSchema: z.object({ id: z.string() }),
    summarize: (i) => `stop process ${i.id}`,
    handler: (i) => gw.shell.stopProcess(i.id),
  });

  void nanoid;
}
