import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * Codex / Claude Code-style editing & search tools layered on top of FsManager.
 * Every write path goes through PathGuard and keeps a backup; grep/glob skip the
 * standard heavy/build directories and binary files.
 */
export function registerEditingTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "edit",
    description:
      "Replace a unique string in a file (oldString -> newString). Keeps a backup and returns a diff. Pass replaceAll to replace every occurrence.",
    risk: 2,
    inputSchema: z.object({
      path: z.string(),
      oldString: z.string(),
      newString: z.string(),
      replaceAll: z.boolean().default(false),
    }),
    summarize: (i) => `edit ${i.path}`,
    handler: (i) => gw.fs.edit(i.path, i.oldString, i.newString, i.replaceAll),
  });

  r.register({
    name: "multi_edit",
    description:
      "Apply a sequence of string-replace edits to one file atomically (all validated before any write). Keeps a single backup.",
    risk: 2,
    inputSchema: z.object({
      path: z.string(),
      edits: z
        .array(
          z.object({
            oldString: z.string(),
            newString: z.string(),
            replaceAll: z.boolean().default(false),
          }),
        )
        .min(1),
    }),
    summarize: (i) => `multi_edit ${i.path} (${i.edits.length} edits)`,
    handler: (i) => gw.fs.multiEdit(i.path, i.edits),
  });

  r.register({
    name: "apply_patch",
    description:
      "Apply a unified diff / patch to a working directory using git apply (dry-run checked, paths validated, backups kept). Returns the resulting diff.",
    risk: 2,
    inputSchema: z.object({ cwd: z.string(), patch: z.string() }),
    summarize: (i) => `apply_patch in ${i.cwd}`,
    handler: (i) => gw.fs.applyPatch(i.cwd, i.patch),
  });

  r.register({
    name: "grep",
    description:
      "Recursively search file contents under a directory (regex or substring, case option, context lines, include/exclude globs). Skips node_modules/.git/dist/build/coverage and binaries.",
    risk: 0,
    inputSchema: z.object({
      path: z.string(),
      query: z.string(),
      regex: z.boolean().default(false),
      caseInsensitive: z.boolean().default(false),
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([]),
      contextBefore: z.number().int().min(0).max(20).default(0),
      contextAfter: z.number().int().min(0).max(20).default(0),
      maxResults: z.number().int().min(1).max(2000).default(200),
    }),
    handler: (i) => ({
      matches: gw.fs.grep(i.path, i.query, {
        regex: i.regex,
        caseInsensitive: i.caseInsensitive,
        include: i.include,
        exclude: i.exclude,
        contextBefore: i.contextBefore,
        contextAfter: i.contextAfter,
        maxResults: i.maxResults,
      }),
    }),
  });

  r.register({
    name: "glob",
    description:
      "Find files matching a glob pattern (supports ** and *) under a directory. Skips node_modules/.git/dist/build/coverage.",
    risk: 0,
    inputSchema: z.object({
      path: z.string(),
      pattern: z.string(),
      maxResults: z.number().int().min(1).max(2000).default(500),
    }),
    handler: (i) => ({ matches: gw.fs.glob(i.path, i.pattern, i.maxResults) }),
  });

  r.register({
    name: "create_directory",
    description: "Create a directory (recursive) inside the allowlist.",
    risk: 2,
    inputSchema: z.object({ path: z.string() }),
    summarize: (i) => `mkdir ${i.path}`,
    handler: (i) => gw.fs.createDirectory(i.path),
  });

  r.register({
    name: "copy_file",
    description: "Copy a file within the allowlist (backup kept if destination exists).",
    risk: 2,
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    summarize: (i) => `copy ${i.from} -> ${i.to}`,
    handler: (i) => gw.fs.copyFile(i.from, i.to),
  });
}
