import { z } from "zod";
import { execFileSafe } from "../util/exec.js";
import type { Gateway } from "../gateway.js";

const PermissionsInput = z
  .object({
    filesystem: z.object({ mode: z.enum(["none", "read", "write"]), allowedDirectories: z.array(z.string()).default([]) }).partial().optional(),
    shell: z.object({ mode: z.enum(["none", "allowed", "custom"]), allowedCommands: z.array(z.string()).default([]) }).partial().optional(),
    network: z.object({ mode: z.enum(["none", "allowlist", "all"]), allowedHosts: z.array(z.string()).default([]) }).partial().optional(),
    secrets: z.array(z.string()).optional(),
    browser: z.enum(["none", "read", "control"]).optional(),
    adb: z.enum(["none", "read", "control"]).optional(),
    git: z.enum(["none", "read", "write"]).optional(),
    agent: z.enum(["none", "plan", "execute"]).optional(),
  })
  .partial();

export function registerSkillTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "skill_list",
    description: "List installed skills with enabled state, risk level and permissions.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () =>
      gw.skills.list().map((s) => ({
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description,
        enabled: s.enabled,
        generated: s.generated,
        riskLevel: s.manifest.riskLevel,
        valid: s.valid,
        tools: s.manifest.tools.map((t) => t.name),
      })),
  });

  r.register({
    name: "skill_info",
    description: "Get full details for a skill including manifest and validation.",
    risk: 0,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => {
      const s = gw.skills.get(i.name);
      if (!s) return { error: "not found" };
      return { ...s, validation: gw.skills.validate(i.name) };
    },
  });

  r.register({
    name: "skill_permissions",
    description: "Show the permission manifest for a skill.",
    risk: 0,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => {
      const s = gw.skills.get(i.name);
      return s ? s.manifest.permissions : { error: "not found" };
    },
  });

  r.register({
    name: "skill_validate",
    description: "Validate a skill's manifest and files.",
    risk: 0,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => gw.skills.validate(i.name),
  });

  r.register({
    name: "skill_enable",
    description: "Enable a skill after reviewing its permissions. Validates first.",
    risk: 2,
    inputSchema: z.object({ name: z.string() }),
    summarize: (i) => `enable skill ${i.name}`,
    handler: (i) => {
      const s = gw.skills.setEnabled(i.name, true);
      return { name: s.manifest.name, enabled: s.enabled };
    },
  });

  r.register({
    name: "skill_disable",
    description: "Disable a skill.",
    risk: 1,
    inputSchema: z.object({ name: z.string() }),
    handler: (i) => {
      const s = gw.skills.setEnabled(i.name, false);
      return { name: s.manifest.name, enabled: s.enabled };
    },
  });

  r.register({
    name: "skill_run",
    description: "Run a tool exposed by an enabled skill in an isolated subprocess.",
    risk: 3,
    inputSchema: z.object({ name: z.string(), tool: z.string(), input: z.unknown().default({}) }),
    summarize: (i) => `run skill ${i.name}.${i.tool}`,
    handler: (i) => gw.skills.run(i.name, i.tool, i.input),
  });

  r.register({
    name: "skill_create",
    description: "Create a skill skeleton (always saved DISABLED).",
    risk: 2,
    inputSchema: z.object({
      name: z.string(),
      description: z.string(),
      permissions: PermissionsInput.optional(),
      riskLevel: z.number().int().min(0).max(4).optional(),
    }),
    summarize: (i) => `create skill ${i.name}`,
    handler: (i) => {
      const s = gw.skills.generate({
        name: i.name,
        description: i.description,
        permissions: i.permissions as any,
        riskLevel: i.riskLevel as any,
      });
      return summarizeGenerated(s);
    },
  });

  r.register({
    name: "skill_generate_from_prompt",
    description:
      "Generate a new skill skeleton from a natural-language spec. The skill is saved DISABLED with declared permissions; review and validate before enabling.",
    risk: 2,
    inputSchema: z.object({
      name: z.string(),
      description: z.string(),
      requirements: z.array(z.string()).default([]),
      permissions: PermissionsInput.optional(),
      riskLevel: z.number().int().min(0).max(4).optional(),
    }),
    summarize: (i) => `generate skill ${i.name}`,
    handler: (i) => {
      const s = gw.skills.generate({
        name: i.name,
        description: i.description,
        requirements: i.requirements,
        permissions: i.permissions as any,
        riskLevel: i.riskLevel as any,
        fromPrompt: true,
      });
      const v = gw.skills.validate(i.name);
      return { ...summarizeGenerated(s), validation: v };
    },
  });

  r.register({
    name: "skill_uninstall",
    description: "Delete a user-installed skill (bundled skills cannot be removed).",
    risk: 2,
    inputSchema: z.object({ name: z.string() }),
    summarize: (i) => `uninstall skill ${i.name}`,
    handler: (i) => ({ removed: gw.skills.uninstall(i.name) }),
  });

  r.register({
    name: "skill_update_permissions",
    description: "Update a skill's permission manifest (skill is disabled as a precaution).",
    risk: 2,
    inputSchema: z.object({ name: z.string(), permissions: PermissionsInput }),
    summarize: (i) => `update permissions for ${i.name}`,
    handler: (i) => {
      const s = gw.skills.get(i.name);
      if (!s) return { error: "not found" };
      gw.skills.setEnabled(i.name, false);
      return { name: i.name, note: "Edit skill.json to change permissions; skill disabled for review.", current: s.manifest.permissions };
    },
  });

  r.register({
    name: "skill_install_from_git",
    description: "Clone a skill from a git URL into the skills directory (saved DISABLED).",
    risk: 3,
    inputSchema: z.object({ url: z.string().url() }),
    summarize: (i) => `install skill from ${i.url}`,
    handler: async (i) => {
      const res = await gw.skills.installFromGit(i.url);
      return { ...res, enabled: false };
    },
  });

  r.register({
    name: "skill_publish_to_git",
    description: "Initialize/commit a skill directory ready to push to a git remote.",
    risk: 4,
    inputSchema: z.object({ name: z.string(), remote: z.string().url().optional() }),
    summarize: (i) => `publish skill ${i.name}`,
    handler: async (i) => {
      const s = gw.skills.get(i.name);
      if (!s) return { error: "not found" };
      const v = gw.skills.validate(i.name);
      if (!v.valid) throw new Error(`Refusing to publish invalid skill: ${v.errors.join("; ")}`);
      await execFileSafe("git", ["init"], { cwd: s.dir, timeoutMs: 30_000 });
      await execFileSafe("git", ["add", "-A"], { cwd: s.dir, timeoutMs: 30_000 });
      await execFileSafe("git", ["commit", "-m", `Publish ${i.name} v${s.manifest.version}`], { cwd: s.dir, timeoutMs: 30_000 });
      if (i.remote) {
        await execFileSafe("git", ["remote", "add", "origin", i.remote], { cwd: s.dir, timeoutMs: 30_000 });
      }
      return { prepared: true, dir: s.dir, remote: i.remote ?? null, note: "Run `git push -u origin main` to publish." };
    },
  });

  r.register({
    name: "skill_search_registry",
    description: "Search configured skill registries (registry.json files) for skills.",
    risk: 0,
    inputSchema: z.object({ query: z.string().default("") }),
    handler: async (i) => {
      const sources = gw.config().skillRegistry.sources;
      const results: unknown[] = [];
      for (const src of sources) {
        try {
          const res = await fetch(src);
          const json = (await res.json()) as { skills?: { name: string; description?: string }[] };
          for (const s of json.skills ?? []) {
            if (!i.query || s.name.includes(i.query) || (s.description ?? "").includes(i.query)) results.push({ ...s, source: src });
          }
        } catch {
          /* skip unreachable registry */
        }
      }
      return { results, sources };
    },
  });
}

function summarizeGenerated(s: { manifest: { name: string; riskLevel: number; permissions: unknown } }) {
  return {
    name: s.manifest.name,
    enabled: false,
    riskLevel: s.manifest.riskLevel,
    permissions: s.manifest.permissions,
    message:
      "Skill created but DISABLED. Review the permissions and README, run skill_validate, then enable with skill_enable (requires approval).",
  };
}
