import { describe, it, expect } from "vitest";
import { defineSkill, describeTool, z } from "@localant/skill-sdk";

const helloTool = {
  description: "say hi",
  inputSchema: z.object({ name: z.string() }),
  handler: ({ name }: { name: string }) => ({ content: `hi ${name}` }),
};

describe("defineSkill", () => {
  it("returns the definition for a valid skill", () => {
    const def = defineSkill({ name: "valid-skill", tools: { hello: helloTool } });
    expect(def.name).toBe("valid-skill");
    expect(def.tools.hello).toBeDefined();
  });

  it("rejects a non-kebab-case name", () => {
    expect(() => defineSkill({ name: "Invalid_Name", tools: { hello: helloTool } })).toThrow(/Invalid skill name/);
  });

  it("rejects a name starting with a hyphen", () => {
    expect(() => defineSkill({ name: "-bad", tools: { hello: helloTool } })).toThrow(/Invalid skill name/);
  });

  it("rejects a skill with no tools", () => {
    expect(() => defineSkill({ name: "empty", tools: {} })).toThrow(/at least one tool/);
  });
});

describe("describeTool", () => {
  it("defaults riskLevel to 0 when unset", () => {
    expect(describeTool(helloTool)).toEqual({ riskLevel: 0 });
  });

  it("preserves an explicit riskLevel", () => {
    expect(describeTool({ ...helloTool, riskLevel: 3 })).toEqual({ riskLevel: 3 });
  });
});
