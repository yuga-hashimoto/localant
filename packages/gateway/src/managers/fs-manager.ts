import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AppPaths, Config } from "@localant/shared";
import { PathGuard } from "../security/path-guard.js";

export interface FileInfo {
  path: string;
  size: number;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  modified: string;
}

/** Filesystem operations gated by PathGuard, with backups before writes. */
export class FsManager {
  constructor(
    private readonly guard: PathGuard,
    private readonly paths: AppPaths,
    private readonly config: () => Config,
  ) {}

  private maxSize(): number {
    return this.config().security.maxFileSizeBytes;
  }

  listFiles(dir: string): FileInfo[] {
    const resolved = this.guard.assertAccess(dir, "read");
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    return entries.map((e) => {
      const full = path.join(resolved, e.name);
      const stat = fs.lstatSync(full);
      return {
        path: full,
        size: stat.size,
        isDirectory: e.isDirectory(),
        isSymbolicLink: e.isSymbolicLink(),
        modified: stat.mtime.toISOString(),
      };
    });
  }

  getInfo(target: string): FileInfo {
    const resolved = this.guard.assertAccess(target, "read");
    const stat = fs.lstatSync(resolved);
    return {
      path: resolved,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      isSymbolicLink: stat.isSymbolicLink(),
      modified: stat.mtime.toISOString(),
    };
  }

  private assertNotBinaryAndSized(resolved: string): void {
    const stat = fs.statSync(resolved);
    if (stat.size > this.maxSize()) {
      throw new Error(`File too large (${stat.size} bytes > ${this.maxSize()} limit).`);
    }
    const fd = fs.openSync(resolved, "r");
    try {
      const len = Math.min(8000, stat.size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      if (buf.includes(0)) throw new Error("Refusing to read binary file (contains NUL bytes).");
    } finally {
      fs.closeSync(fd);
    }
  }

  readFile(target: string): string {
    const resolved = this.guard.assertAccess(target, "read");
    this.assertNotBinaryAndSized(resolved);
    return fs.readFileSync(resolved, "utf8");
  }

  readRange(target: string, startLine: number, endLine: number): string {
    const content = this.readFile(target);
    const lines = content.split("\n");
    return lines.slice(Math.max(0, startLine - 1), endLine).join("\n");
  }

  searchFiles(dir: string, pattern: string, limit = 200): string[] {
    const resolved = this.guard.assertAccess(dir, "read");
    const rx = globToRegExp(pattern);
    const out: string[] = [];
    const walk = (d: string) => {
      if (out.length >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= limit) return;
        if (e.name === "node_modules" || e.name === ".git") continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (rx.test(e.name)) out.push(full);
      }
    };
    walk(resolved);
    return out;
  }

  searchContent(dir: string, query: string, limit = 200): { file: string; line: number; text: string }[] {
    const resolved = this.guard.assertAccess(dir, "read");
    const results: { file: string; line: number; text: string }[] = [];
    const walk = (d: string) => {
      if (results.length >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= limit) return;
        if (e.name === "node_modules" || e.name === ".git") continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          try {
            const stat = fs.statSync(full);
            if (stat.size > this.maxSize()) continue;
            const lines = fs.readFileSync(full, "utf8").split("\n");
            lines.forEach((text, i) => {
              if (results.length < limit && text.includes(query)) {
                results.push({ file: full, line: i + 1, text: text.slice(0, 240) });
              }
            });
          } catch {
            /* skip unreadable/binary */
          }
        }
      }
    };
    walk(resolved);
    return results;
  }

  /** Write a *draft* file (risk 1) — refuses to overwrite existing files. */
  writeDraft(target: string, content: string): { path: string } {
    const resolved = this.guard.assertAccess(target, "write");
    if (fs.existsSync(resolved)) {
      throw new Error(`Draft refused: '${target}' already exists. Use fs_apply_patch_with_backup to modify.`);
    }
    if (Buffer.byteLength(content) > this.maxSize()) throw new Error("Content exceeds max file size.");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    return { path: resolved };
  }

  createFile(target: string, content: string, overwrite: boolean): { path: string; backupId?: string } {
    const resolved = this.guard.assertAccess(target, "write");
    let backupId: string | undefined;
    if (fs.existsSync(resolved)) {
      if (!overwrite) throw new Error(`File exists: '${target}'. Pass overwrite=true to replace (a backup is kept).`);
      backupId = this.backup(resolved).id;
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    return { path: resolved, ...(backupId ? { backupId } : {}) };
  }

  /** Replace whole-file content with a backup kept (risk 2). */
  applyPatchWithBackup(target: string, newContent: string): { path: string; backupId: string } {
    const resolved = this.guard.assertAccess(target, "write");
    if (!fs.existsSync(resolved)) throw new Error(`File not found: '${target}'.`);
    const backup = this.backup(resolved);
    fs.writeFileSync(resolved, newContent);
    return { path: resolved, backupId: backup.id };
  }

  moveFile(from: string, to: string): { from: string; to: string } {
    const src = this.guard.assertAccess(from, "write");
    const dst = this.guard.assertAccess(to, "write");
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { from: src, to: dst };
  }

  deleteFile(target: string): { path: string; backupId: string } {
    const resolved = this.guard.assertAccess(target, "write");
    if (!fs.existsSync(resolved)) throw new Error(`File not found: '${target}'.`);
    const backup = this.backup(resolved);
    fs.rmSync(resolved, { recursive: false });
    return { path: resolved, backupId: backup.id };
  }

  backup(target: string): { id: string; original: string; backupPath: string } {
    const resolved = this.guard.assertAccess(target, "read");
    const id = `${Date.now()}-${nanoid(6)}`;
    const backupPath = path.join(this.paths.backupsDir, `${id}__${path.basename(resolved)}`);
    fs.mkdirSync(this.paths.backupsDir, { recursive: true });
    fs.copyFileSync(resolved, backupPath);
    const metaPath = `${backupPath}.meta.json`;
    fs.writeFileSync(metaPath, JSON.stringify({ id, original: resolved, createdAt: new Date().toISOString() }));
    return { id, original: resolved, backupPath };
  }

  listBackups(): { id: string; original: string; createdAt: string }[] {
    if (!fs.existsSync(this.paths.backupsDir)) return [];
    return fs
      .readdirSync(this.paths.backupsDir)
      .filter((f) => f.endsWith(".meta.json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.paths.backupsDir, f), "utf8")))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  restoreBackup(id: string): { restored: string } {
    const metaFile = fs
      .readdirSync(this.paths.backupsDir)
      .find((f) => f.endsWith(".meta.json") && f.startsWith(id + "__") === false && JSON.parse(fs.readFileSync(path.join(this.paths.backupsDir, f), "utf8")).id === id);
    if (!metaFile) throw new Error(`Backup not found: ${id}`);
    const meta = JSON.parse(fs.readFileSync(path.join(this.paths.backupsDir, metaFile), "utf8"));
    const backupPath = path.join(this.paths.backupsDir, metaFile.replace(/\.meta\.json$/, ""));
    const dst = this.guard.assertAccess(meta.original, "write");
    fs.copyFileSync(backupPath, dst);
    return { restored: dst };
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
