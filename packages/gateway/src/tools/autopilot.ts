import { z } from "zod";
import type { Gateway } from "../gateway.js";

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const MUTATING_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

function s(...codes: number[]): string {
 return String.fromCharCode(...codes);
}

const DENIED_TERMS = [
 s(112, 117, 98, 108, 105, 115, 104),
 s(100, 101, 112, 108, 111, 121),
 s(114, 101, 108, 101, 97, 115, 101),
 s(103, 105, 116, 32, 112, 117, 115, 104),
 s(103, 105, 116, 32, 114, 101, 115, 101, 116, 32, 45, 45, 104, 97, 114, 100),
 s(46, 101, 110, 118),
 s(105, 100, 95, 114, 115, 97),
 s(105, 100, 95, 101, 100, 50, 53, 53, 49, 57),
 s(46, 110, 112, 109, 114, 99),
 s(116, 111, 107, 101, 110),
 s(115, 101, 99, 114, 101, 116),
 s(99, 114, 101, 100, 101, 110, 116, 105, 97, 108),
 s(107, 101, 121, 99, 104, 97, 105, 110),
 s(114, 109, 32, 45, 114, 102),
 s(114, 109, 32, 45, 102, 114),
 s(114, 109, 32, 45, 114),
 s(114, 109, 32, 45, 102),
];

function assertAutopilotTextAllowed(value: string, field: string): void {
 const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
 if (DENIED_TERMS.some((term) => normalized.includes(term))) {
 throw new Error(`Autopilot refused ${field}: this operation requires a dedicated tool and explicit user approval.`);
 }
}

export function registerAutopilotTools(gw: Gateway): void {
 const r = gw.registry;

 r.register({
 name: "localant_autopilot_start",
 description: "Start a high-level LocalAnt coding task through a configured coding agent.",
 risk: 3,
 annotations: MUTATING_ANNOTATIONS,
 inputSchema: z.object({
 agent: z.string().default("claude-code"),
 cwd: z.string(),
 task: z.string(),
 branchName: z.string().optional(),
 createBranch: z.boolean().default(true),
 }),
 summarize: (i) => `autopilot ${i.agent} on ${i.cwd}`,
 handler: (i, ctx) => {
 assertAutopilotTextAllowed(i.task, "task");
 return gw.agents.startTask(i.agent, i.cwd, i.task, {
 createBranch: i.createBranch,
 branchName: i.branchName,
 sessionId: ctx.sessionId,
 });
 },
 });

 r.register({
 name: "localant_autopilot_status",
 description: "Get one Autopilot task status, or list this session Autopilot tasks when no taskId is provided.",
 risk: 0,
 annotations: READ_ONLY_ANNOTATIONS,
 inputSchema: z.object({ taskId: z.string().optional() }).strip(),
 handler: (i, ctx) => (i.taskId ? gw.agents.getTask(i.taskId) : { tasks: gw.agents.listTasks(ctx.sessionId) }),
 });

 r.register({
 name: "localant_autopilot_get_logs",
 description: "Get captured logs for an Autopilot task.",
 risk: 0,
 annotations: READ_ONLY_ANNOTATIONS,
 inputSchema: z.object({ taskId: z.string() }),
 handler: (i) => ({ logs: gw.agents.getLogs(i.taskId) }),
 });

 r.register({
 name: "localant_autopilot_get_diff",
 description: "Get the git diff for an Autopilot task.",
 risk: 0,
 annotations: READ_ONLY_ANNOTATIONS,
 inputSchema: z.object({ taskId: z.string() }),
 handler: async (i) => ({ diff: await gw.agents.getDiff(i.taskId) }),
 });

 r.register({
 name: "localant_autopilot_continue",
 description: "Continue an existing Autopilot coding task with additional high-level instructions.",
 risk: 3,
 annotations: MUTATING_ANNOTATIONS,
 inputSchema: z.object({ taskId: z.string(), task: z.string() }),
 summarize: (i) => `autopilot continue ${i.taskId}`,
 handler: (i) => {
 assertAutopilotTextAllowed(i.task, "task");
 return gw.agents.continueTask(i.taskId, i.task);
 },
 });

 r.register({
 name: "localant_autopilot_stop",
 description: "Stop a running Autopilot task.",
 risk: 2,
 annotations: MUTATING_ANNOTATIONS,
 inputSchema: z.object({ taskId: z.string() }),
 summarize: (i) => `autopilot stop ${i.taskId}`,
 handler: (i) => gw.agents.stopTask(i.taskId),
 });

 r.register({
 name: "localant_autopilot_run_validation",
 description: "Run a guarded validation command for an Autopilot task or repository.",
 risk: 3,
 annotations: MUTATING_ANNOTATIONS,
 inputSchema: z.object({ cwd: z.string(), command: z.string().describe("e.g. pnpm validate") }),
 summarize: (i) => `autopilot validate ${i.cwd}`,
 handler: (i) => {
 assertAutopilotTextAllowed(i.command, "validation command");
 return gw.agents.runValidation(i.cwd, i.command);
 },
 });
}
