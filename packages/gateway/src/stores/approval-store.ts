import fs from "node:fs";
import { nanoid } from "nanoid";
import type { AppPaths, ApprovalRequest, RiskLevel } from "@localant/shared";

/**
 * Persistent approval queue. Approvals can be granted via the CLI, the
 * dashboard, or MCP approval tools — ChatGPT-side confirmation is never
 * trusted alone.
 */
export class ApprovalStore {
  private readonly file: string;
  /** session id -> set of tool names approved for the whole session. */
  private readonly sessionGrants = new Map<string, Set<string>>();

  constructor(paths: AppPaths) {
    this.file = paths.approvalsFile;
  }

  private read(): ApprovalRequest[] {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as ApprovalRequest[];
    } catch {
      return [];
    }
  }

  private write(items: ApprovalRequest[]): void {
    fs.writeFileSync(this.file, JSON.stringify(items, null, 2), { mode: 0o600 });
  }

  create(input: {
    tool: string;
    risk: RiskLevel;
    requirement: "single" | "double";
    reason: string;
    summary: string;
    caller: string;
    sessionId?: string;
  }): ApprovalRequest {
    const req: ApprovalRequest = {
      id: nanoid(10),
      createdAt: new Date().toISOString(),
      status: "pending",
      approvalsGiven: 0,
      ...input,
    };
    const items = this.read();
    items.push(req);
    this.write(items);
    return req;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.read().find((r) => r.id === id);
  }

  listPending(): ApprovalRequest[] {
    return this.read().filter((r) => r.status === "pending");
  }

  list(limit = 100): ApprovalRequest[] {
    return this.read().slice(-limit).reverse();
  }

  approve(id: string, scope: "once" | "session" = "once"): ApprovalRequest | undefined {
    const items = this.read();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    const req = items[idx]!;
    if (req.status !== "pending") return req;
    const given = req.approvalsGiven + 1;
    const needed = req.requirement === "double" ? 2 : 1;
    const updated: ApprovalRequest = {
      ...req,
      approvalsGiven: given,
      scope,
      ...(given >= needed
        ? { status: "approved" as const, resolvedAt: new Date().toISOString() }
        : {}),
    };
    items[idx] = updated;
    this.write(items);
    if (updated.status === "approved" && scope === "session" && req.sessionId) {
      const set = this.sessionGrants.get(req.sessionId) ?? new Set();
      set.add(req.tool);
      this.sessionGrants.set(req.sessionId, set);
    }
    return updated;
  }

  deny(id: string): ApprovalRequest | undefined {
    const items = this.read();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    const updated: ApprovalRequest = {
      ...items[idx]!,
      status: "denied",
      resolvedAt: new Date().toISOString(),
    };
    items[idx] = updated;
    this.write(items);
    return updated;
  }

  hasSessionGrant(sessionId: string | undefined, tool: string): boolean {
    if (!sessionId) return false;
    return this.sessionGrants.get(sessionId)?.has(tool) ?? false;
  }

  /** Find an approved-but-unconsumed once-approval for a tool. */
  findApprovedForTool(tool: string): ApprovalRequest | undefined {
    return this.read().find((r) => r.tool === tool && r.status === "approved" && r.scope !== "session");
  }

  /** Mark a once-approval as consumed so it cannot be reused. */
  consume(id: string): void {
    const items = this.read();
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return;
    items[idx] = { ...items[idx]!, status: "expired", resolvedAt: new Date().toISOString() };
    this.write(items);
  }
}
