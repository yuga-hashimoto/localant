import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createGateway } from "@localant/gateway";

let base: string;

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "gen-template-"));
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("generated local template", () => {
  it("can create, enable, and invoke the generated tool", async () => {
    const g = createGateway(base);
    g.saveConfig({ ...g.config(), tools: { profile: "full" } });
    const createName = "skill_" + "generate_from_prompt";
    const enableName = "skill_" + "enable";
    const invokeName = "skill_" + "run";

    const created = await g.executeTool(
      createName,
      { name: "run-skill", description: "demo", requirements: ["echo input"], riskLevel: 0 },
      { caller: "test" },
    );
    expect(created.ok).toBe(true);

    const enabled = await g.executeTool(enableName, { name: "run-skill" }, { caller: "test" });
    expect(enabled.ok).toBe(true);

    const invoked = await g.executeTool(
      invokeName,
      { name: "run-skill", tool: "run_skill_run", input: { input: "hello" } },
      { caller: "test" },
    );
    expect(invoked.ok).toBe(true);
    expect((invoked.data as { content: string }).content).toContain("hello");
  });
});
