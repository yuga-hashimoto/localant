import { z } from "zod";
import type { Gateway } from "../gateway.js";

/** Resolve a project id or raw path to a filesystem path. */
function resolveRepo(gw: Gateway, repoOrId: string): string {
  const project = gw.projects.get(repoOrId);
  return project ? project.path : repoOrId;
}

export function registerGitTools(gw: Gateway): void {
  const r = gw.registry;
  const repoArg = z.object({ repo: z.string().describe("Project id/name or path") });

  r.register({
    name: "git_status",
    description: "Show git status for a project or repo path.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.status(resolveRepo(gw, i.repo)) }),
  });
  r.register({
    name: "git_diff",
    description: "Show the working-tree diff.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.diff(resolveRepo(gw, i.repo)) }),
  });
  r.register({
    name: "git_diff_file",
    description: "Show the diff for a single file.",
    risk: 0,
    inputSchema: z.object({ repo: z.string(), file: z.string() }),
    handler: async (i) => ({ output: await gw.git.diffFile(resolveRepo(gw, i.repo), i.file) }),
  });
  r.register({
    name: "git_list_changed_files",
    description: "List changed files (porcelain).",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.listChangedFiles(resolveRepo(gw, i.repo)) }),
  });
  r.register({
    name: "git_branch",
    description: "List branches.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ output: await gw.git.branch(resolveRepo(gw, i.repo)) }),
  });
  r.register({
    name: "git_log",
    description: "Show recent commit log.",
    risk: 0,
    inputSchema: z.object({ repo: z.string(), n: z.number().int().min(1).max(200).default(20) }),
    handler: async (i) => ({ output: await gw.git.log(resolveRepo(gw, i.repo), i.n) }),
  });
  r.register({
    name: "git_create_patch",
    description: "Create a patch of current changes.",
    risk: 0,
    inputSchema: repoArg,
    handler: async (i) => ({ patch: await gw.git.createPatch(resolveRepo(gw, i.repo)) }),
  });
  r.register({
    name: "git_create_branch",
    description: "Create and checkout a new branch.",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), name: z.string() }),
    summarize: (i) => `git branch ${i.name}`,
    handler: async (i) => ({ output: await gw.git.createBranch(resolveRepo(gw, i.repo), i.name) }),
  });
  r.register({
    name: "git_checkout_branch",
    description: "Checkout an existing branch.",
    risk: 2,
    inputSchema: z.object({ repo: z.string(), name: z.string() }),
    summarize: (i) => `git checkout ${i.name}`,
    handler: async (i) => ({ output: await gw.git.checkoutBranch(resolveRepo(gw, i.repo), i.name) }),
  });
  r.register({
    name: "git_commit",
    description: "Commit changes with a message (optionally git add -A first).",
    risk: 3,
    inputSchema: z.object({ repo: z.string(), message: z.string(), addAll: z.boolean().default(true) }),
    summarize: (i) => `git commit: ${i.message.slice(0, 60)}`,
    handler: async (i) => ({ output: await gw.git.commit(resolveRepo(gw, i.repo), i.message, i.addAll) }),
  });
  r.register({
    name: "git_restore_file",
    description: "Discard changes to a file (git restore).",
    risk: 3,
    inputSchema: z.object({ repo: z.string(), file: z.string() }),
    summarize: (i) => `git restore ${i.file}`,
    handler: async (i) => ({ output: await gw.git.restoreFile(resolveRepo(gw, i.repo), i.file) }),
  });
}
