import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createGateway } from "@localant/gateway";

let base: string;
let proj: string;

function gw() {
  const g = createGateway(base);
  g.saveConfig({
    ...g.config(),
    tools: { profile: "full" },
    security: { ...g.config().security, mode: "open", allowedDirectories: [base] },
  });
  return g;
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-fsbug-"));
  proj = path.join(base, "proj");
  fs.mkdirSync(proj, { recursive: true });
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("edit: replacement text is inserted literally (no $-pattern interpretation)", () => {
  // String.prototype.replace(string, string) interprets `$$`, `$&`, `$\`` and
  // `$'` in the replacement. The edit tool must insert newString verbatim.
  const cases: { name: string; newString: string }[] = [
    { name: "$& (matched substring)", newString: "a$&b" },
    { name: "$$ (literal dollar escape)", newString: "price = $$5" },
    { name: "$` (preceding text)", newString: "x$`y" },
    { name: "$' (following text)", newString: "x$'y" },
  ];

  for (const c of cases) {
    it(`single replace preserves ${c.name}`, async () => {
      const file = path.join(proj, "dollar.ts");
      fs.writeFileSync(file, "const x = MARKER;\n");
      const g = gw();
      const res = await g.executeTool(
        "edit",
        { path: file, oldString: "MARKER", newString: c.newString },
        { caller: "test" },
      );
      expect(res.ok, res.error).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toBe(`const x = ${c.newString};\n`);
    });
  }

  it("multi_edit preserves $-patterns in replacement text", async () => {
    const file = path.join(proj, "multi.ts");
    fs.writeFileSync(file, "ONE TWO\n");
    const g = gw();
    const res = await g.executeTool(
      "multi_edit",
      {
        path: file,
        edits: [
          { oldString: "ONE", newString: "a$&b" },
          { oldString: "TWO", newString: "c$$d" },
        ],
      },
      { caller: "test" },
    );
    expect(res.ok, res.error).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("a$&b c$$d\n");
  });
});

describe("fs-manager source integrity", () => {
  it("contains no embedded NUL bytes (file stays valid text)", () => {
    const src = path.join(process.cwd(), "packages/gateway/src/managers/fs-manager.ts");
    const bytes = fs.readFileSync(src);
    expect(bytes.includes(0)).toBe(false);
  });
});

describe("glob: path-aware ** behavior is preserved", () => {
  it("matches files across directory boundaries with **", async () => {
    fs.mkdirSync(path.join(proj, "src", "sub"), { recursive: true });
    fs.writeFileSync(path.join(proj, "src", "a.ts"), "a");
    fs.writeFileSync(path.join(proj, "src", "sub", "b.ts"), "b");
    fs.writeFileSync(path.join(proj, "src", "c.txt"), "c");
    const g = gw();
    const res = await g.executeTool("glob", { path: proj, pattern: "src/**/*.ts" }, { caller: "test" });
    expect(res.ok, res.error).toBe(true);
    const matches = (res.data as { matches: string[] }).matches.map((p) => path.basename(p)).sort();
    expect(matches).toEqual(["a.ts", "b.ts"]);
  });
});
