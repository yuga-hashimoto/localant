import fs from "node:fs";
import { nanoid } from "nanoid";
import { redact, truncate, type AppPaths, type AuditEntry, type RiskLevel } from "@localant/shared";

/** Append-only audit log backed by a JSONL file. Secrets are redacted. */
export class AuditLog {
  private readonly file: string;
  private secretsProvider: () => string[] = () => [];

  constructor(paths: AppPaths) {
    this.file = paths.auditLog;
  }

  setSecretsProvider(fn: () => string[]): void {
    this.secretsProvider = fn;
  }

  record(entry: {
    tool: string;
    caller: string;
    risk: RiskLevel;
    input: unknown;
    output: unknown;
    approval: AuditEntry["approval"];
    durationMs: number;
    error?: string;
  }): AuditEntry {
    const secrets = this.secretsProvider();
    const full: AuditEntry = {
      id: nanoid(12),
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      caller: entry.caller,
      risk: entry.risk,
      inputSummary: truncate(redact(safeStringify(entry.input), secrets), 500),
      outputSummary: truncate(redact(safeStringify(entry.output), secrets), 500),
      approval: entry.approval,
      durationMs: entry.durationMs,
      ...(entry.error ? { error: truncate(redact(entry.error, secrets), 500) } : {}),
    };
    fs.appendFileSync(this.file, JSON.stringify(full) + "\n");
    return full;
  }

  list(limit = 100, offset = 0): AuditEntry[] {
    const all = this.readAll();
    return all.slice(Math.max(0, all.length - offset - limit), all.length - offset).reverse();
  }

  get(id: string): AuditEntry | undefined {
    return this.readAll().find((e) => e.id === id);
  }

  search(query: string, limit = 100): AuditEntry[] {
    const q = query.toLowerCase();
    return this.readAll()
      .filter(
        (e) =>
          e.tool.toLowerCase().includes(q) ||
          e.inputSummary.toLowerCase().includes(q) ||
          (e.error ?? "").toLowerCase().includes(q),
      )
      .reverse()
      .slice(0, limit);
  }

  readAll(): AuditEntry[] {
    try {
      return fs
        .readFileSync(this.file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      return [];
    }
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
