import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appPaths } from "@localant/shared";
import { ApprovalStore } from "@localant/gateway";

let base: string;
function store() {
  const p = appPaths(base);
  fs.writeFileSync(p.approvalsFile, JSON.stringify([]), { mode: 0o600 });
  return new ApprovalStore(p);
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-ap-"));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const baseReq = {
  tool: "fs_create_file",
  risk: 2 as const,
  reason: "test",
  summary: "create a file",
  caller: "test",
};

describe("ApprovalStore", () => {
  it("creates a pending request", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single" });
    expect(req.status).toBe("pending");
    expect(s.listPending()).toHaveLength(1);
  });

  it("approves a single-approval request in one step", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single" });
    const approved = s.approve(req.id, "once");
    expect(approved?.status).toBe("approved");
    expect(s.listPending()).toHaveLength(0);
  });

  it("requires two approvals for a double-approval request", () => {
    const s = store();
    const req = s.create({ ...baseReq, risk: 4, requirement: "double" });
    const first = s.approve(req.id, "once");
    expect(first?.status).toBe("pending");
    expect(first?.approvalsGiven).toBe(1);
    const second = s.approve(req.id, "once");
    expect(second?.status).toBe("approved");
    expect(second?.approvalsGiven).toBe(2);
  });

  it("denies a request", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single" });
    expect(s.deny(req.id)?.status).toBe("denied");
    expect(s.listPending()).toHaveLength(0);
  });

  it("consumes a once-approval so it cannot be reused", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single" });
    s.approve(req.id, "once");
    expect(s.findApprovedForTool("fs_create_file")?.id).toBe(req.id);
    s.consume(req.id);
    expect(s.findApprovedForTool("fs_create_file")).toBeUndefined();
  });

  it("grants a session-scoped approval for the whole session", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single", sessionId: "sess-1" });
    s.approve(req.id, "session");
    expect(s.hasSessionGrant("sess-1", "fs_create_file")).toBe(true);
    expect(s.hasSessionGrant("other", "fs_create_file")).toBe(false);
    // session grants are not exposed as reusable once-approvals
    expect(s.findApprovedForTool("fs_create_file")).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    const s = store();
    expect(s.approve("nope")).toBeUndefined();
    expect(s.deny("nope")).toBeUndefined();
  });

  it("only lets the owning session consume a session-tagged once-approval", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single", sessionId: "chat-a" });
    s.approve(req.id, "once");
    // A different chat must not be able to consume chat-a's approval.
    expect(s.findApprovedForTool("fs_create_file", "chat-b")).toBeUndefined();
    // The owning chat can.
    expect(s.findApprovedForTool("fs_create_file", "chat-a")?.id).toBe(req.id);
  });

  it("treats legacy approvals without a sessionId as consumable by anyone", () => {
    const s = store();
    const req = s.create({ ...baseReq, requirement: "single" });
    s.approve(req.id, "once");
    // No sessionId recorded → any session (or none) can consume it.
    expect(s.findApprovedForTool("fs_create_file", "chat-x")?.id).toBe(req.id);
    expect(s.findApprovedForTool("fs_create_file")?.id).toBe(req.id);
  });

  it("approveAllPending advances every pending request and clears the queue", () => {
    const s = store();
    s.create({ ...baseReq, requirement: "single" });
    s.create({ ...baseReq, tool: "fs_delete", requirement: "single" });
    const n = s.approveAllPending("once");
    expect(n).toBe(2);
    expect(s.listPending()).toHaveLength(0);
  });

  it("approveAllPending with double requirement leaves them pending after one pass", () => {
    const s = store();
    s.create({ ...baseReq, requirement: "double" });
    const n = s.approveAllPending("once");
    expect(n).toBe(1); // advanced one step…
    expect(s.listPending()).toHaveLength(1); // …but still needs a second approval
  });

  it("denyAllPending denies every pending request", () => {
    const s = store();
    s.create({ ...baseReq, requirement: "single" });
    s.create({ ...baseReq, tool: "fs_delete", requirement: "single" });
    const n = s.denyAllPending();
    expect(n).toBe(2);
    expect(s.listPending()).toHaveLength(0);
  });
});
