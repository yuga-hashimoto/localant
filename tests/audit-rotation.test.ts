import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AuditLog } from "@localant/gateway";
import { appPaths, type AuditEntry } from "@localant/shared";

let base: string;

function pathsFor(dir: string) {
  return appPaths(dir);
}

/** Write a raw JSONL audit file with entries at the given ages (in days). */
function seed(file: string, agesDays: number[], now: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = agesDays.map((age, i) => {
    const entry: Partial<AuditEntry> = {
      id: `e${i}`,
      timestamp: new Date(now - age * 24 * 60 * 60 * 1000).toISOString(),
      tool: "bash",
    };
    return JSON.stringify(entry);
  });
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-audit-"));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("audit log rotation", () => {
  it("prunes entries older than the retention window", () => {
    const now = Date.now();
    const paths = pathsFor(base);
    seed(paths.auditLog, [40, 31, 29, 1], now); // retention = 30 days
    const log = new AuditLog(paths);
    log.setRetentionProvider(() => 30);
    const remaining = log.readAll();
    expect(remaining.map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("keeps everything when retention is non-positive (disabled)", () => {
    const now = Date.now();
    const paths = pathsFor(base);
    seed(paths.auditLog, [100, 50, 1], now);
    const log = new AuditLog(paths);
    log.setRetentionProvider(() => 0);
    expect(log.readAll()).toHaveLength(3);
  });

  it("returns the number of pruned entries and rewrites the file", () => {
    const now = Date.now();
    const paths = pathsFor(base);
    const log = new AuditLog(paths);
    log.setRetentionProvider(() => 7); // wired before the file exists; no-op prune
    seed(paths.auditLog, [10, 5, 2], now);
    const removed = log.prune(now);
    expect(removed).toBe(1);
    expect(fs.readFileSync(paths.auditLog, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("does not drop entries with an unparseable timestamp", () => {
    const paths = pathsFor(base);
    fs.mkdirSync(path.dirname(paths.auditLog), { recursive: true });
    fs.writeFileSync(paths.auditLog, JSON.stringify({ id: "x", timestamp: "not-a-date", tool: "bash" }) + "\n");
    const log = new AuditLog(paths);
    log.setRetentionProvider(() => 1);
    expect(log.readAll().map((e) => e.id)).toEqual(["x"]);
  });
});
