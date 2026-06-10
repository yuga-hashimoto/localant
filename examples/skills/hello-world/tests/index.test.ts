import { describe, it, expect } from "vitest";
import skill from "../src/index";

describe("hello-world skill", () => {
  it("exposes the hello tool", () => {
    expect(skill.name).toBe("hello-world");
    expect(skill.tools.hello).toBeDefined();
  });

  it("greets a name", async () => {
    const ctx = { getSecret: async () => undefined, workspaceDir: ".", log: () => {} };
    const out = (await skill.tools.hello.handler({ name: "Yuga" }, ctx)) as { content: string };
    expect(out.content).toContain("Hello, Yuga!");
  });

  it("validates input", () => {
    expect(() => skill.tools.hello.inputSchema.parse({})).toThrow();
  });
});
