import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sensitiveBlocklist } from "@localant/shared";

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAccessError";
  }
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function normalizeAbs(p: string): string {
  return path.resolve(expandHome(p));
}

/** True if `child` is `parent` or nested under it (prefix check on segments). */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolves and validates a requested path against the allowed directories and
 * the sensitive blocklist. Defends against:
 *  - path traversal (`../`)
 *  - symlink traversal (realpath of every existing ancestor is re-checked)
 *  - access to sensitive system/credential paths
 */
export class PathGuard {
  private readonly blocklist: string[];

  constructor(private allowedDirs: string[]) {
    this.blocklist = sensitiveBlocklist().map(normalizeAbs);
  }

  setAllowedDirectories(dirs: string[]): void {
    this.allowedDirs = dirs;
  }

  allowed(): string[] {
    return this.allowedDirs.map(normalizeAbs);
  }

  private inBlocklist(resolved: string): boolean {
    return this.blocklist.some((b) => isWithin(b, resolved));
  }

  private inAllowlist(resolved: string): boolean {
    return this.allowed().some((dir) => isWithin(dir, resolved));
  }

  /**
   * Resolve the realpath of the deepest existing ancestor and re-check it.
   * This catches a symlink anywhere along the path that points outside the
   * allowlist (e.g. `~/Projects/evil -> /etc`).
   */
  private resolveRealAncestor(resolved: string): string {
    let current = resolved;
    const tail: string[] = [];
    // Walk up until we find a path that exists on disk.
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      tail.unshift(path.basename(current));
      current = parent;
    }
    let real: string;
    try {
      real = fs.realpathSync(current);
    } catch {
      real = current;
    }
    return tail.length ? path.join(real, ...tail) : real;
  }

  /**
   * Validate a path for the requested mode. Returns the normalized absolute
   * path. Throws PathAccessError on any violation.
   */
  assertAccess(requested: string, mode: "read" | "write"): string {
    const resolved = normalizeAbs(requested);

    if (this.inBlocklist(resolved)) {
      throw new PathAccessError(`Access denied: '${requested}' is in the sensitive blocklist.`);
    }
    if (!this.inAllowlist(resolved)) {
      throw new PathAccessError(
        `Access denied: '${requested}' is outside the allowed directories. Add it with fs_add_allowed_directory.`,
      );
    }

    // Re-check after resolving symlinks on existing ancestors.
    const real = this.resolveRealAncestor(resolved);
    if (this.inBlocklist(real)) {
      throw new PathAccessError(`Access denied: '${requested}' resolves (via symlink) into a sensitive path.`);
    }
    if (!this.inAllowlist(real)) {
      throw new PathAccessError(`Access denied: '${requested}' resolves (via symlink) outside allowed directories.`);
    }

    void mode; // mode-specific policy is enforced by callers / permission engine.
    return resolved;
  }
}
