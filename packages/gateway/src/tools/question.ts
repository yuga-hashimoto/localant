import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * Human-in-the-loop tools. `question`/`ask_user` persist a pending question that
 * the human answers in the dashboard or CLI — ChatGPT cannot mark its own
 * question answered. `approval_request` creates an explicit approval via the
 * ApprovalStore (never auto-granted on ChatGPT's say-so).
 */
export function registerQuestionTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "question",
    description:
      "Ask the human a question and pause. Saves a pending question (visible in the dashboard/CLI) and returns its id. Poll the answer via approval/question listings — do not assume an answer.",
    risk: 1,
    inputSchema: z.object({ question: z.string(), context: z.string().optional() }),
    summarize: (i) => `question: ${i.question.slice(0, 80)}`,
    handler: (i) => {
      const rec = gw.todos.createQuestion(i.question, i.context);
      return {
        questionId: rec.id,
        status: rec.status,
        message: "Question saved. The human must answer it in the dashboard or via `localant`.",
      };
    },
  });

  // ask_user is an alias-style duplicate kept distinct so both names resolve.
  r.register({
    name: "ask_user",
    description: "Alias of `question`: ask the human and pause for an answer.",
    risk: 1,
    inputSchema: z.object({ question: z.string(), context: z.string().optional() }),
    summarize: (i) => `ask_user: ${i.question.slice(0, 80)}`,
    handler: (i) => {
      const rec = gw.todos.createQuestion(i.question, i.context);
      return { questionId: rec.id, status: rec.status };
    },
  });

  r.register({
    name: "approval_request",
    description: "Create an explicit approval request (risk-gated action) the human must approve.",
    risk: 0,
    inputSchema: z.object({ action: z.string(), risk: z.number().int().min(0).max(4).default(3), reason: z.string().default("") }),
    handler: (i, ctx) => {
      const req = gw.approvals.create({
        tool: i.action,
        risk: i.risk as 0 | 1 | 2 | 3 | 4,
        requirement: i.risk >= 4 ? "double" : "single",
        reason: i.reason || `Requested approval for ${i.action}`,
        summary: i.action,
        caller: ctx.caller,
        sessionId: ctx.sessionId,
      });
      return { approvalId: req.id, message: `Approval requested. Approve with: localant approvals approve ${req.id}.` };
    },
  });
}
