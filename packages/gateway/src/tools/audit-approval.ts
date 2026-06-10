import { z } from "zod";
import type { Gateway } from "../gateway.js";

export function registerAuditTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "audit_list_logs",
    description: "List recent audit log entries (most recent first).",
    risk: 0,
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(50), offset: z.number().int().min(0).default(0) }),
    handler: (i) => gw.audit.list(i.limit, i.offset),
  });

  r.register({
    name: "audit_get_log",
    description: "Get a single audit entry by id.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => gw.audit.get(i.id) ?? { error: "not found" },
  });

  r.register({
    name: "audit_search_logs",
    description: "Search audit entries by tool name, input or error text.",
    risk: 0,
    inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(500).default(50) }),
    handler: (i) => gw.audit.search(i.query, i.limit),
  });

  r.register({
    name: "audit_export_logs",
    description: "Export all audit entries as a JSON array.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.audit.readAll(),
  });
}

export function registerApprovalTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "approval_list_pending",
    description: "List pending approval requests awaiting the user's decision.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.approvals.listPending(),
  });

  r.register({
    name: "approval_get",
    description: "Get a single approval request by id.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => gw.approvals.get(i.id) ?? { error: "not found" },
  });

  r.register({
    name: "approval_approve",
    description:
      "Approve a pending request. scope 'once' approves a single call; 'session' approves the tool for the session. NOTE: this should reflect an explicit human decision.",
    risk: 0,
    inputSchema: z.object({ id: z.string(), scope: z.enum(["once", "session"]).default("once") }),
    handler: (i) => gw.approvals.approve(i.id, i.scope) ?? { error: "not found" },
  });

  r.register({
    name: "approval_deny",
    description: "Deny a pending approval request.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => gw.approvals.deny(i.id) ?? { error: "not found" },
  });
}
