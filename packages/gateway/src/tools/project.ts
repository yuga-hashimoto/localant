import { z } from "zod";
import type { Gateway } from "../gateway.js";

export function registerProjectTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "project_list",
    description: "List registered local projects.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.projects.list(),
  });

  r.register({
    name: "project_register",
    description: "Register a local project directory (must be inside an allowed directory).",
    risk: 1,
    inputSchema: z.object({ path: z.string(), name: z.string().optional() }),
    summarize: (i) => `register project ${i.name ?? i.path}`,
    handler: (i) => gw.projects.register(i.path, i.name),
  });

  r.register({
    name: "project_unregister",
    description: "Remove a project from the registry (does not delete files).",
    risk: 1,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => ({ removed: gw.projects.unregister(i.id) }),
  });

  r.register({
    name: "project_get",
    description: "Get a project by id or name.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => gw.projects.get(i.id) ?? { error: "not found" },
  });

  r.register({
    name: "project_status",
    description: "Get project details plus current git status.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: async (i) => {
      const p = gw.projects.get(i.id);
      if (!p) return { error: "not found" };
      let git: string | undefined;
      try {
        git = await gw.git.status(p.path);
      } catch (e) {
        git = `(not a git repo or error: ${(e as Error).message})`;
      }
      return { project: p, git };
    },
  });

  r.register({
    name: "project_set_validate_command",
    description: "Set the validate command for a project (e.g. 'pnpm validate').",
    risk: 1,
    inputSchema: z.object({ id: z.string(), command: z.string() }),
    handler: (i) => gw.projects.update(i.id, { validateCommand: i.command }),
  });

  r.register({
    name: "project_set_test_command",
    description: "Set the test command for a project.",
    risk: 1,
    inputSchema: z.object({ id: z.string(), command: z.string() }),
    handler: (i) => gw.projects.update(i.id, { testCommand: i.command }),
  });

  r.register({
    name: "project_set_default_agent",
    description: "Set the default coding agent for a project.",
    risk: 1,
    inputSchema: z.object({ id: z.string(), agent: z.string() }),
    handler: (i) => gw.projects.update(i.id, { defaultAgent: i.agent }),
  });

  r.register({
    name: "project_detect_stack",
    description: "Detect the tech stack of a project directory.",
    risk: 0,
    inputSchema: z.object({ id: z.string() }),
    handler: (i) => {
      const p = gw.projects.get(i.id);
      if (!p) return { error: "not found" };
      return { stack: gw.projects.detectStack(p.path) };
    },
  });
}
