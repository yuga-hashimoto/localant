import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import skill from "../src/index";

const ctx = { getSecret: async () => undefined, workspaceDir: ".", log: () => {} };
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-org-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("file-organizer skill", () => {
  it("exposes plan and apply tools", () => {
    expect(skill.name).toBe("file-organizer");
    expect(skill.tools.file_organizer_plan).toBeDefined();
    expect(skill.tools.file_organizer_apply).toBeDefined();
  });

  it("plans moves by type without touching files", async () => {
    fs.writeFileSync(path.join(dir, "a.png"), "x");
    fs.writeFileSync(path.join(dir, "b.pdf"), "x");
    const out = (await skill.tools.file_organizer_plan.handler({ dir, by: "type" }, ctx)) as {
      count: number;
      moves: { file: string; into: string }[];
    };
    expect(out.count).toBe(2);
    expect(out.moves.find((m) => m.file === "a.png")?.into).toBe("images");
    // Nothing actually moved.
    expect(fs.existsSync(path.join(dir, "a.png"))).toBe(true);
  });

  it("applies moves into type buckets", async () => {
    fs.writeFileSync(path.join(dir, "photo.jpg"), "x");
    fs.writeFileSync(path.join(dir, "notes.md"), "x");
    fs.writeFileSync(path.join(dir, "weird.xyz"), "x");
    const out = (await skill.tools.file_organizer_apply.handler({ dir, by: "type" }, ctx)) as { moved: number };
    expect(out.moved).toBe(3);
    expect(fs.existsSync(path.join(dir, "images", "photo.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "documents", "notes.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "other", "weird.xyz"))).toBe(true);
  });

  it("leaves subdirectories and dotfiles alone", async () => {
    fs.mkdirSync(path.join(dir, "keep"));
    fs.writeFileSync(path.join(dir, ".hidden"), "x");
    const out = (await skill.tools.file_organizer_apply.handler({ dir, by: "type" }, ctx)) as { moved: number };
    expect(out.moved).toBe(0);
    expect(fs.existsSync(path.join(dir, "keep"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".hidden"))).toBe(true);
  });

  it("rejects a non-directory", () => {
    expect(() => skill.tools.file_organizer_plan.handler({ dir: path.join(dir, "nope"), by: "type" }, ctx)).toThrow();
  });
});
