import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AppPaths, Config } from "@localant/shared";
import { PathGuard } from "../security/path-guard.js";
import { execFileSafe } from "../util/exec.js";

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

  /** Directories that are always skipped by grep/glob. */
  private static readonly DEFAULT_IGNORES = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
  ]);

  /** Create a directory (recursive). */
  createDirectory(target: string): { path: string } {
    const resolved = this.guard.assertAccess(target, "write");
    fs.mkdirSync(resolved, { recursive: true });
    return { path: resolved };
  }

  /** Copy a file within the allowlist (backup kept if destination exists). */
  copyFile(from: string, to: string): { from: string; to: string; backupId?: string } {
    const src = this.guard.assertAccess(from, "read");
    const dst = this.guard.assertAccess(to, "write");
    let backupId: string | undefined;
    if (fs.existsSync(dst)) backupId = this.backup(dst).id;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return { from: src, to: dst, ...(backupId ? { backupId } : {}) };
  }

  /**
   * String-replace edit (Codex / Claude Code style). Replaces `oldString` with
   * `newString`. By default the match must be unique; pass `replaceAll` to
   * replace every occurrence. A backup is taken before writing.
   */
  edit(
    target: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): { path: string; backupId: string; replacements: number; diff: string } {
    const resolved = this.guard.assertAccess(target, "write");
    if (!fs.existsSync(resolved)) throw new Error(`File not found: '${target}'.`);
    this.assertNotBinaryAndSized(resolved);
    const before = fs.readFileSync(resolved, "utf8");
    const count = countOccurrences(before, oldString);
    if (count === 0) throw new Error(`edit failed: oldString not found in '${target}'.`);
    if (count > 1 && !replaceAll) {
      throw new Error(
        `edit failed: oldString matches ${count} times in '${target}'. Pass replaceAll=true or provide more context.`,
      );
    }
    const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
    const backup = this.backup(resolved);
    fs.writeFileSync(resolved, after);
    return { path: resolved, backupId: backup.id, replacements: replaceAll ? count : 1, diff: simpleDiff(before, after) };
  }

  /**
   * Apply a sequence of string-replace edits atomically: every edit is validated
   * against the in-memory buffer first; only if all succeed is the file written
   * (with a single backup). A failing edit leaves the file untouched.
   */
  multiEdit(
    target: string,
    edits: { oldString: string; newString: string; replaceAll?: boolean }[],
  ): { path: string; backupId: string; applied: number; diff: string } {
    const resolved = this.guard.assertAccess(target, "write");
    if (!fs.existsSync(resolved)) throw new Error(`File not found: '${target}'.`);
    this.assertNotBinaryAndSized(resolved);
    const before = fs.readFileSync(resolved, "utf8");
    let buf = before;
    edits.forEach((e, idx) => {
      const count = countOccurrences(buf, e.oldString);
      if (count === 0) throw new Error(`multi_edit failed at edit #${idx + 1}: oldString not found.`);
      if (count > 1 && !e.replaceAll) {
        throw new Error(`multi_edit failed at edit #${idx + 1}: oldString matches ${count} times (pass replaceAll).`);
      }
      buf = e.replaceAll ? buf.split(e.oldString).join(e.newString) : buf.replace(e.oldString, e.newString);
    });
    const backup = this.backup(resolved);
    fs.writeFileSync(resolved, buf);
    return { path: resolved, backupId: backup.id, applied: edits.length, diff: simpleDiff(before, buf) };
  }

  /** Recursive grep over a directory. */
  grep(
    dir: string,
    query: string,
    opts: {
      regex?: boolean;
      caseInsensitive?: boolean;
      include?: string[];
      exclude?: string[];
      contextBefore?: number;
      contextAfter?: number;
      maxResults?: number;
    } = {},
  ): { file: string; line: number; text: string; context?: { before: string[]; after: string[] } }[] {
    const root = this.guard.assertAccess(dir, "read");
    const maxResults = opts.maxResults ?? 200;
    const before = Math.max(0, opts.contextBefore ?? 0);
    const after = Math.max(0, opts.contextAfter ?? 0);
    const includeRx = (opts.include ?? []).map((g) => globToRegExp(g));
    const excludeRx = (opts.exclude ?? []).map((g) => globToRegExp(g));
    const matcher: (s: string) => boolean = opts.regex
      ? (() => {
          const rx = new RegExp(query, opts.caseInsensitive ? "i" : "");
          return (s: string) => rx.test(s);
        })()
      : opts.caseInsensitive
        ? (s) => s.toLowerCase().includes(query.toLowerCase())
        : (s) => s.includes(query);

    const out: { file: string; line: number; text: string; context?: { before: string[]; after: string[] } }[] = [];
    const walk = (d: string) => {
      if (out.length >= maxResults) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= maxResults) return;
        if (e.isDirectory()) {
          if (FsManager.DEFAULT_IGNORES.has(e.name)) continue;
          walk(path.join(d, e.name));
          continue;
        }
        const full = path.join(d, e.name);
        if (includeRx.length && !includeRx.some((rx) => rx.test(e.name))) continue;
        if (excludeRx.some((rx) => rx.test(e.name))) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > this.maxSize()) continue;
          const content = fs.readFileSync(full);
          if (content.includes(0)) continue; // binary
          const lines = content.toString("utf8").split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (out.length >= maxResults) break;
            if (matcher(lines[i]!)) {
              const ctx =
                before || after
                  ? {
                      before: lines.slice(Math.max(0, i - before), i),
                      after: lines.slice(i + 1, i + 1 + after),
                    }
                  : undefined;
              out.push({ file: full, line: i + 1, text: lines[i]!.slice(0, 400), ...(ctx ? { context: ctx } : {}) });
            }
          }
        } catch {
          /* skip unreadable */
        }
      }
    };
    walk(root);
    return out;
  }

  /** Glob for files (supports `**` and `*`), ignoring the default dirs. */
  glob(dir: string, pattern: string, maxResults = 500): string[] {
    const root = this.guard.assertAccess(dir, "read");
    const rx = globToRegExp(pattern, true);
    const out: string[] = [];
    const walk = (d: string) => {
      if (out.length >= maxResults) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= maxResults) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (FsManager.DEFAULT_IGNORES.has(e.name)) continue;
          walk(full);
        } else {
          const rel = path.relative(root, full);
          if (rx.test(rel) || rx.test(e.name)) out.push(full);
        }
      }
    };
    walk(root);
    return out;
  }

  /**
   * Apply a unified diff / patch text to a working directory using `git apply`.
   * Every file the patch touches is validated against PathGuard (so a patch
   * cannot escape the allowlist via `../`), backed up, then applied after a
   * `git apply --check` dry-run. Returns the resulting diff.
   */
  async applyPatch(
    cwd: string,
    patch: string,
  ): Promise<{ cwd: string; files: string[]; backups: { file: string; backupId: string }[]; diff: string }> {
    const root = this.guard.assertAccess(cwd, "write");
    const files = parsePatchFiles(patch);
    if (files.length === 0) throw new Error("apply_patch: no target files found in patch.");

    // Validate every touched path is inside the allowlist (defeats traversal).
    const backups: { file: string; backupId: string }[] = [];
    for (const rel of files) {
      const abs = path.resolve(root, rel);
      this.guard.assertAccess(abs, "write");
      if (fs.existsSync(abs)) backups.push({ file: rel, backupId: this.backup(abs).id });
    }

    // Write the patch to a temp file inside the workspace tmp dir.
    const patchFile = path.join(os.tmpdir(), `localant-patch-${nanoid(8)}.diff`);
    fs.writeFileSync(patchFile, patch.endsWith("\n") ? patch : patch + "\n");
    try {
      const check = await execFileSafe("git", ["apply", "--check", patchFile], { cwd: root, timeoutMs: 30_000 });
      if (check.code !== 0) {
        throw new Error(`apply_patch: dry-run failed: ${check.stderr || check.stdout}`.trim());
      }
      const applied = await execFileSafe("git", ["apply", patchFile], { cwd: root, timeoutMs: 30_000 });
      if (applied.code !== 0) {
        throw new Error(`apply_patch: failed: ${applied.stderr || applied.stdout}`.trim());
      }
    } finally {
      try {
        fs.rmSync(patchFile, { force: true });
      } catch {
        /* ignore */
      }
    }

    const diff = await execFileSafe("git", ["diff"], { cwd: root, timeoutMs: 30_000 });
    return { cwd: root, files, backups, diff: diff.stdout };
  }

  restoreBackup(id: string): { restored: string } {
    const metaFile = fs
      .readdirSync(this.paths.backupsDir)
      .find((f) => f.endsWith(".meta.json") && JSON.parse(fs.readFileSync(path.join(this.paths.backupsDir, f), "utf8")).id === id);
    if (!metaFile) throw new Error(`Backup not found: ${id}`);
    const meta = JSON.parse(fs.readFileSync(path.join(this.paths.backupsDir, metaFile), "utf8"));
    const backupPath = path.join(this.paths.backupsDir, metaFile.replace(/\.meta\.json$/, ""));
    const dst = this.guard.assertAccess(meta.original, "write");
    fs.copyFileSync(backupPath, dst);
    return { restored: dst };
  }
}

/**
 * Convert a glob to a RegExp. When `pathAware` is true, `**` matches across
 * path separators and `*` matches within a single segment; otherwise `*`
 * matches anything (used for plain filename matching).
 */
function globToRegExp(glob: string, pathAware = false): RegExp {
  if (!pathAware) {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
  }
  // Path-aware: handle ** before * using placeholders.
  let re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  re = re
    .replace(/\*\*\//g, " SLASHSTAR ")
    .replace(/\*\*/g, " DOUBLESTAR ")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/ SLASHSTAR /g, "(?:.*/)?")
    .replace(/ DOUBLESTAR /g, ".*");
  return new RegExp(`^${re}$`, "i");
}

/** Extract the set of target file paths from a unified diff / patch. */
function parsePatchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split("\n")) {
    let m = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (m && m[1] && m[1] !== "/dev/null") {
      files.add(m[1].replace(/\t.*$/, "").trim());
      continue;
    }
    m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (m && m[2]) files.add(m[2].trim());
  }
  return [...files];
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Produce a compact line-level diff (added/removed) for audit/feedback. */
function simpleDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: string[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`- ${a[i]}`);
    if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
  }
  return lines.slice(0, 200).join("\n");
}
