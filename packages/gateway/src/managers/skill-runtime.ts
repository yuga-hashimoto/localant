import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SkillPermissionsSchema,
  type AppPaths,
  type SkillManifest,
  type SkillState,
  type RiskLevel,
} from "@chatgpt-local-app/shared";
import { execFileSafe } from "../util/exec.js";

const RUNNER = fileURLToPath(new URL("../skill-runner.js", import.meta.url));

interface SkillStateFile {
  enabled: Record<string, boolean>;
}

/**
 * Loads, validates, enables/disables, runs and generates local skills.
 * Generated skills are always saved disabled.
 */
export class SkillRuntime {
  private readonly stateFile: string;

  constructor(
    private readonly paths: AppPaths,
    private readonly secretResolver: (names: string[]) => Record<string, string>,
  ) {
    this.stateFile = path.join(paths.root, "skills-state.json");
  }

  private loadState(): SkillStateFile {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as SkillStateFile;
    } catch {
      return { enabled: {} };
    }
  }
  private saveState(state: SkillStateFile): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  /** Directories that may contain skills: the user skills dir + bundled examples. */
  private skillDirs(): string[] {
    const dirs = [this.paths.skillsDir];
    // bundled examples directory (when running from the repo / published package)
    const bundled = fileURLToPath(new URL("../../../../examples/skills", import.meta.url));
    if (fs.existsSync(bundled)) dirs.push(bundled);
    return dirs;
  }

  list(): SkillState[] {
    const state = this.loadState();
    const skills: SkillState[] = [];
    const seen = new Set<string>();
    for (const base of this.skillDirs()) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(base, entry.name);
        const manifestPath = path.join(dir, "skill.json");
        if (!fs.existsSync(manifestPath)) continue;
        const loaded = this.readManifest(manifestPath);
        if (!loaded || seen.has(loaded.manifest.name)) continue;
        seen.add(loaded.manifest.name);
        const generated = fs.existsSync(path.join(dir, ".generated"));
        skills.push({
          manifest: loaded.manifest,
          dir,
          enabled: state.enabled[loaded.manifest.name] ?? false,
          generated,
          installedAt: this.installedAt(dir),
          valid: loaded.errors.length === 0,
          validationErrors: loaded.errors,
        });
      }
    }
    return skills.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  get(name: string): SkillState | undefined {
    return this.list().find((s) => s.manifest.name === name);
  }

  private installedAt(dir: string): string {
    try {
      return fs.statSync(dir).birthtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private readManifest(manifestPath: string): { manifest: SkillManifest; errors: string[] } | undefined {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      return undefined;
    }
    const errors: string[] = [];
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name !== "string") errors.push("Missing 'name'.");
    if (typeof obj.version !== "string") errors.push("Missing 'version'.");
    if (typeof obj.entry !== "string") errors.push("Missing 'entry'.");
    if (!Array.isArray(obj.tools) || obj.tools.length === 0) errors.push("Must declare at least one tool.");
    let permissions;
    try {
      permissions = SkillPermissionsSchema.parse(obj.permissions ?? {});
    } catch {
      permissions = SkillPermissionsSchema.parse({});
      errors.push("Invalid 'permissions' block.");
    }
    const manifest: SkillManifest = {
      name: String(obj.name ?? "unknown"),
      displayName: obj.displayName as string | undefined,
      version: String(obj.version ?? "0.0.0"),
      description: String(obj.description ?? ""),
      author: obj.author as string | undefined,
      license: obj.license as string | undefined,
      entry: String(obj.entry ?? "src/index.ts"),
      riskLevel: (typeof obj.riskLevel === "number" ? obj.riskLevel : 1) as RiskLevel,
      permissions,
      tools: (Array.isArray(obj.tools) ? obj.tools : []) as SkillManifest["tools"],
    };
    return { manifest, errors };
  }

  validate(name: string): { valid: boolean; errors: string[] } {
    const skill = this.get(name);
    if (!skill) return { valid: false, errors: [`Skill not found: ${name}`] };
    const errors = [...skill.validationErrors];
    const entry = path.join(skill.dir, skill.manifest.entry);
    if (!fs.existsSync(entry)) errors.push(`Entry file missing: ${skill.manifest.entry}`);
    if (!fs.existsSync(path.join(skill.dir, "README.md"))) errors.push("Missing README.md");
    return { valid: errors.length === 0, errors };
  }

  setEnabled(name: string, enabled: boolean): SkillState {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    if (enabled) {
      const v = this.validate(name);
      if (!v.valid) throw new Error(`Cannot enable invalid skill: ${v.errors.join("; ")}`);
    }
    const state = this.loadState();
    state.enabled[name] = enabled;
    this.saveState(state);
    return { ...skill, enabled };
  }

  /** Execute a tool inside a skill in an isolated subprocess. */
  async run(name: string, tool: string, input: unknown): Promise<unknown> {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    if (!skill.enabled) throw new Error(`Skill '${name}' is disabled. Enable it after reviewing permissions.`);
    const toolDef = skill.manifest.tools.find((t) => t.name === tool);
    if (!toolDef) throw new Error(`Tool '${tool}' not found in skill '${name}'.`);

    const secrets = this.secretResolver(skill.manifest.permissions.secrets);
    const payload = JSON.stringify({
      entry: path.join(skill.dir, skill.manifest.entry),
      tool,
      input,
      secrets,
      workspaceDir: this.paths.workspaceDir,
    });
    const res = await execFileSafe(process.execPath, [RUNNER], {
      input: payload,
      timeoutMs: 60_000,
      maxOutputBytes: 200_000,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    if (res.code !== 0) {
      throw new Error(`Skill execution failed: ${res.stderr || res.stdout || "unknown error"}`.trim());
    }
    const line = res.stdout.trim().split("\n").pop() ?? "{}";
    const parsed = JSON.parse(line) as { ok: boolean; result?: unknown; error?: string };
    if (!parsed.ok) throw new Error(parsed.error ?? "Skill returned an error.");
    return parsed.result;
  }

  /** Create a skill skeleton on disk (always disabled). */
  generate(input: {
    name: string;
    description: string;
    requirements?: string[];
    permissions?: Partial<SkillManifest["permissions"]>;
    riskLevel?: RiskLevel;
    fromPrompt?: boolean;
  }): SkillState {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.name)) {
      throw new Error(`Invalid skill name '${input.name}'. Use lowercase kebab-case.`);
    }
    const dir = path.join(this.paths.skillsDir, input.name);
    if (fs.existsSync(dir)) throw new Error(`Skill '${input.name}' already exists.`);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.mkdirSync(path.join(dir, "examples"), { recursive: true });

    const permissions = SkillPermissionsSchema.parse(input.permissions ?? {});
    const risk = (input.riskLevel ?? 1) as RiskLevel;
    const toolName = `${input.name.replace(/-/g, "_")}_run`;
    const manifest: SkillManifest = {
      name: input.name,
      displayName: input.name,
      version: "0.1.0",
      description: input.description,
      author: "local",
      license: "MIT",
      entry: "src/index.ts",
      riskLevel: risk,
      permissions,
      tools: [
        {
          name: toolName,
          description: input.description,
          riskLevel: risk,
          inputSchema: {
            type: "object",
            properties: { input: { type: "string" } },
            required: [],
          },
        },
      ],
    };

    fs.writeFileSync(path.join(dir, "skill.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(dir, ".generated"), new Date().toISOString());
    fs.writeFileSync(path.join(dir, "LICENSE"), "MIT\n");
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), `# Changelog\n\n## 0.1.0\n- Generated skill skeleton.\n`);
    fs.writeFileSync(
      path.join(dir, "README.md"),
      readmeTemplate(input.name, input.description, input.requirements ?? [], permissions, risk),
    );
    fs.writeFileSync(path.join(dir, "src", "index.ts"), skillSrcTemplate(input.name, toolName, input.requirements ?? []));
    fs.writeFileSync(path.join(dir, "tests", "index.test.ts"), skillTestTemplate(input.name, toolName));
    fs.writeFileSync(path.join(dir, "examples", "example.json"), JSON.stringify({ input: "hello" }, null, 2));

    const state = this.get(input.name);
    if (!state) throw new Error("Generated skill could not be loaded.");
    return state;
  }

  uninstall(name: string): boolean {
    const skill = this.get(name);
    if (!skill) return false;
    if (!skill.dir.startsWith(this.paths.skillsDir)) {
      throw new Error("Refusing to uninstall a bundled skill.");
    }
    fs.rmSync(skill.dir, { recursive: true, force: true });
    const state = this.loadState();
    delete state.enabled[name];
    this.saveState(state);
    return true;
  }
}

function readmeTemplate(
  name: string,
  description: string,
  requirements: string[],
  perms: SkillManifest["permissions"],
  risk: RiskLevel,
): string {
  return `# ${name}

${description}

> ⚠️ This skill was generated and is **disabled by default**. Review the permissions below, run \`skill_validate\`, then enable it from the dashboard or CLI.

## Requirements
${requirements.map((r) => `- ${r}`).join("\n") || "- (none specified)"}

## Permissions
- filesystem: ${perms.filesystem.mode}
- shell: ${perms.shell.mode}
- network: ${perms.network.mode}${perms.network.allowedHosts.length ? ` (${perms.network.allowedHosts.join(", ")})` : ""}
- secrets: ${perms.secrets.join(", ") || "none"}
- risk level: ${risk}

## Usage
Call the tool \`${name.replace(/-/g, "_")}_run\` from ChatGPT once enabled.
`;
}

function skillSrcTemplate(name: string, toolName: string, requirements: string[]): string {
  return `import { defineSkill, z } from "@chatgpt-local-app/skill-sdk";

// Requirements:
${requirements.map((r) => `// - ${r}`).join("\n") || "// - implement me"}

export default defineSkill({
  name: "${name}",
  tools: {
    ${toolName}: {
      description: "TODO: describe what this tool does",
      riskLevel: 1,
      inputSchema: z.object({
        input: z.string().optional(),
      }),
      handler: async ({ input }, ctx) => {
        ctx.log("running ${name}");
        // TODO: implement. Use ctx.getSecret(name) for any declared secrets.
        return { content: \`${name} received: \${input ?? ""}\` };
      },
    },
  },
});
`;
}

function skillTestTemplate(name: string, toolName: string): string {
  return `import { describe, it, expect } from "vitest";
import skill from "../src/index";

describe("${name}", () => {
  it("declares its tool", () => {
    expect(skill.name).toBe("${name}");
    expect(skill.tools.${toolName}).toBeDefined();
  });

  it("runs", async () => {
    const ctx = { getSecret: async () => undefined, workspaceDir: ".", log: () => {} };
    const out = await skill.tools.${toolName}.handler({ input: "x" } as any, ctx);
    expect(out).toBeTruthy();
  });
});
`;
}
