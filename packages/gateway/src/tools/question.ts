import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * Human-in-the-loop. We deliberately do NOT ship `question`/`ask_user` tools —
 * ChatGPT asks the user directly in the chat, so a tool for it is redundant.
 * Only `approval_request` is exposed: it creates an explicit, risk-gated approval
 * via the ApprovalStore that the HUMAN must grant (never auto-granted on
 * ChatGPT's say-so).
 */
export function registerQuestionTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "approval_request",
    description: "Create an explicit approval request (risk-gated action) the human must approve in the dashboard or CLI.",
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
