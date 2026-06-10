import { z } from "zod";
import type { RiskLevel } from "@chatgpt-local-app/shared";

export { z };
export type { RiskLevel };

/** Context handed to every skill tool handler at runtime. */
export interface SkillContext {
  /** Resolve a named secret the skill is permitted to access. */
  getSecret(name: string): Promise<string | undefined>;
  /** Workspace directory the skill may use for scratch files. */
  workspaceDir: string;
  /** Structured logger scoped to the skill. */
  log: (msg: string, extra?: unknown) => void;
}

export interface SkillToolDefinition<I = unknown, O = unknown> {
  description: string;
  riskLevel?: RiskLevel;
  inputSchema: z.ZodType<I>;
  handler: (input: I, ctx: SkillContext) => Promise<O> | O;
}

export interface SkillDefinition {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  tools: Record<string, SkillToolDefinition>;
}

/**
 * Define a local skill. The returned object is consumed by the gateway skill
 * runtime; authors should `export default defineSkill({...})`.
 */
export function defineSkill(def: SkillDefinition): SkillDefinition {
  if (!def.name || !/^[a-z0-9][a-z0-9-]*$/.test(def.name)) {
    throw new Error(`Invalid skill name: ${def.name}. Use lowercase kebab-case.`);
  }
  if (!def.tools || Object.keys(def.tools).length === 0) {
    throw new Error(`Skill ${def.name} must define at least one tool.`);
  }
  return def;
}

/** Helper to convert a Zod schema to a JSON-schema-ish object for manifests. */
export function describeTool(tool: SkillToolDefinition): { riskLevel: RiskLevel } {
  return { riskLevel: tool.riskLevel ?? 0 };
}
