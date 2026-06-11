import { z } from "zod";
import type { Gateway } from "../gateway.js";

export function registerGitTools(gw: Gateway): void {
  const r = gw.registry;
  const repoArg = z.object({ repo: z.string().describe("Path to the repository") });

  r.register({
    name: "git_status",
    description: "Show git status for a project or repo path.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.status(i.repo) }),
  });
  r.register({
    name: "git_diff",
    description: "Show the working-tree diff.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.diff(i.repo) }),
  });
  r.register({
    name: "git_diff_file",
    description: "Show the diff for a single file.",
    risk: 0,
    inputSchema: z.object({ repo: z.string(), file: z.string() }),
    handler: async (i) => ({ output: await gw.git.diffFile(i.repo, i.file) }),
  });
  r.register({
    name: "git_list_changed_files",
    description: "List changed files (porcelain).",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.listChangedFiles(i.repo) }),
  });
  r.register({
    name: "git_branch",
    description: "List branches.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.branch(i.repo) }),
  });
  r.register({
    name: "git_log",
    description: "Show recent commit log.",
    risk: 0,
    inputSchema: z.object({ repo: z.string(), n: z.number().int().min(1).max(200).default(20) }),
    handler: async (i) => ({ output: await gw.git.log(i.repo, i.n) }),
  });
  r.register({
    name: "git_create_patch",
    description: "Create a patch of current changes.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ patch: await gw.git.createPatch(i.repo) }),
  });
  r.register({
    name: "git_create_branch",
    description: "Create and checkout a new branch.",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), name: z.string() }),
    summarize: (i) => `git branch ${i.name}`,
    handler: async (i) => ({ output: await gw.git.createBranch(i.repo, i.name) }),
  });
  r.register({
    name: "git_checkout_branch",
    description: "Checkout an existing branch.",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), name: z.string() }),
    summarize: (i) => `git checkout ${i.name}`,
    handler: async (i) => ({ output: await gw.git.checkoutBranch(i.repo, i.name) }),
  });
  r.register({
    name: "git_commit",
    description: "Commit changes with a message (optionally git add -A first).",
    risk: 3,
    inputSchema: z.object({ repo: z.string(), message: z.string(), addAll: z.boolean().default(true) }),
    summarize: (i) => `git commit: ${i.message.slice(0, 60)}`,
    handler: async (i) => ({ output: await gw.git.commit(i.repo, i.message, i.addAll) }),
  });
  r.register({
    name: "git_restore_file",
    description: "Discard changes to a file (git restore).",
    risk: 3,
    inputSchema: z.object({ repo: z.string(), file: z.string() }),
    summarize: (i) => `git restore ${i.file}`,
    handler: async (i) => ({ output: await gw.git.restoreFile(i.repo, i.file) }),
  });

  r.register({
    name: "git_add",
    description: "Stage files (git add). Stages everything when no paths given.",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), paths: z.array(z.string()).default([]) }),
    summarize: (i) => `git add ${i.paths.length ? i.paths.join(" ") : "-A"}`,
    handler: async (i) => ({ output: await gw.git.add(i.repo, i.paths) }),
  });

  r.register({
    name: "git_reset",
    description: "git reset --soft|--mixed|--hard. Hard reset is destructive (risk 4).",
    // The schema can't change risk per-call, so register hard as a separate
    // risk-4 path; this tool covers soft/mixed only.
    risk: 2,
    inputSchema: z.object({
      repo: z.string(),
      mode: z.enum(["soft", "mixed"]).default("mixed"),
      ref: z.string().default("HEAD"),
    }),
    summarize: (i) => `git reset --${i.mode} ${i.ref}`,
    handler: async (i) => ({ output: await gw.git.reset(i.repo, i.mode, i.ref) }),
  });

  r.register({
    name: "git_reset_hard",
    description: "git reset --hard (DESTRUCTIVE: discards commits and working-tree changes).",
    risk: 4,
    inputSchema: z.object({ repo: z.string(), ref: z.string().default("HEAD") }),
    summarize: (i) => `git reset --hard ${i.ref}`,
    handler: async (i) => ({ output: await gw.git.reset(i.repo, "hard", i.ref) }),
  });

  r.register({
    name: "git_stash",
    description: "Stash working-tree changes (git stash push).",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), message: z.string().optional() }),
    summarize: () => `git stash`,
    handler: async (i) => ({ output: await gw.git.stash(i.repo, i.message) }),
  });

  r.register({
    name: "git_clean_preview",
    description: "Preview files that 'git clean' would remove (does NOT delete anything).",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.cleanPreview(i.repo) }),
  });

  r.register({
    name: "git_apply_patch",
    description: "Apply a unified diff to the repo (git apply, with a dry-run check first).",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), patch: z.string() }),
    summarize: () => `git apply patch`,
    handler: async (i) => ({ output: await gw.git.applyPatch(i.repo, i.patch) }),
  });

  r.register({
    name: "git_get_current_branch",
    description: "Get the current branch name.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ branch: await gw.git.currentBranch(i.repo) }),
  });

  r.register({
    name: "git_is_dirty",
    description: "Report whether the working tree has uncommitted changes.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ dirty: await gw.git.isDirty(i.repo) }),
  });
}
