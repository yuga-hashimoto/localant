import { z } from "zod";
import type { RiskLevel, ToolHintAnnotations } from "@localant/shared";

/**
 * A tool is generic over its Zod input schema `S`. Handlers receive the
 * *output* type (`z.output<S>`), so `.default(...)` fields are non-optional.
 */
export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  risk: RiskLevel;
  annotations?: ToolHintAnnotations;
  meta?: Record<string, unknown>;
  inputSchema: S;
  /** Short human summary of an invocation, used for audit + approval prompts. */
  summarize?: (input: z.output<S>) => string;
  /**
   * Sanitized view of the input recorded in the audit log. Use this to keep
   * bulky or sensitive payloads (e.g. base64 image chunks) out of the log while
   * still recording the metadata that matters. Defaults to the raw input.
   */
  auditInput?: (input: z.output<S>) => unknown;
  handler: (input: z.output<S>, ctx: ToolCallContext) => Promise<unknown> | unknown;
}

export interface ToolCallContext {
  caller: string;
  sessionId?: string;
}

/** In-memory registry of all tools the gateway exposes. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<S extends z.ZodTypeAny>(def: ToolDefinition<S>): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Duplicate tool registration: ${def.name}`);
    }
    this.tools.set(def.name, def as unknown as ToolDefinition);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
