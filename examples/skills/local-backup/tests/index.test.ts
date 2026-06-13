import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import skill from "../src/index";

let root: string;
let src: string;
let out: string;
const ctxFor = (workspaceDir: string) => ({ getSecret: async () => undefined, workspaceDir, log: () => {} });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "local-backup-"));
  src = path.join(root, "project");
  out = path.join(root, "backups");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "file.txt"), "hello");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("local-backup skill", () => {
  it("exposes create and list tools", () => {
    expect(skill.name).toBe("local-backup");
    expect(skill.tools.local_backup_create).toBeDefined();
    expect(skill.tools.local_backup_list).toBeDefined();
  });

  it("creates a tar.gz archive of a directory", async () => {
    const res = (await skill.tools.local_backup_create.handler({ dir: src, outDir: out }, ctxFor(out))) as {
      archive: string;
      bytes: number;
    };
    expect(fs.existsSync(res.archive)).toBe(true);
    expect(res.archive.endsWith(".tar.gz")).toBe(true);
    expect(res.bytes).toBeGreaterThan(0);
  });

  it("lists previously created archives", async () => {
    await skill.tools.local_backup_create.handler({ dir: src, outDir: out }, ctxFor(out));
    const res = (await skill.tools.local_backup_list.handler({ outDir: out }, ctxFor(out))) as {
      archives: { name: string }[];
    };
    expect(res.archives.length).toBe(1);
    expect(res.archives[0]!.name).toContain("project-");
  });

  it("rejects a missing source directory", async () => {
    await expect(
      skill.tools.local_backup_create.handler({ dir: path.join(root, "nope") }, ctxFor(out)),
    ).rejects.toThrow();
  });
});
