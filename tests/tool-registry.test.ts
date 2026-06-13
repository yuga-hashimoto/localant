import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "@localant/gateway";

/**
 * The project registry referenced by issue #5 was removed in bd5a170 (coding
 * agents now run on a path, no registration). The remaining registration unit
 * is the ToolRegistry — these tests cover register / get / list / unregister
 * and the duplicate-registration guard.
 */
function tool(name: string) {
  return {
    name,
    description: name,
    risk: 0 as const,
    inputSchema: z.object({}),
    handler: () => ({ ok: true }),
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const r = new ToolRegistry();
    r.register(tool("alpha"));
    expect(r.get("alpha")?.name).toBe("alpha");
  });

  it("rejects duplicate registration", () => {
    const r = new ToolRegistry();
    r.register(tool("dup"));
    expect(() => r.register(tool("dup"))).toThrow(/Duplicate/);
  });

  it("lists tools sorted by name", () => {
    const r = new ToolRegistry();
    r.register(tool("gamma"));
    r.register(tool("alpha"));
    r.register(tool("beta"));
    expect(r.list().map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("unregisters a tool and returns undefined afterwards", () => {
    const r = new ToolRegistry();
    r.register(tool("temp"));
    r.unregister("temp");
    expect(r.get("temp")).toBeUndefined();
  });

  it("unregistering an unknown tool is a no-op", () => {
    const r = new ToolRegistry();
    expect(() => r.unregister("ghost")).not.toThrow();
  });
});
