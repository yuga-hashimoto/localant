import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveExecutable } from "@localant/gateway";

/**
 * Windows CLI-shim resolution. On Windows, `spawn(file, args, { shell: false })`
 * does not apply PATHEXT, so a bare `claude` / `npx` (installed as `.cmd`) fails
 * with ENOENT. resolveExecutable probes PATH × PATHEXT itself. The function is
 * parameterized so the win32 branch can be exercised from any host OS.
 */
describe("resolveExecutable", () => {
  it("returns the input unchanged on non-Windows platforms", () => {
    expect(resolveExecutable("claude", "darwin")).toBe("claude");
    expect(resolveExecutable("claude", "linux")).toBe("claude");
  });

  describe("on win32", () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "winexe-"));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("resolves a bare name to a .cmd shim on PATH", () => {
      const shim = path.join(dir, "claude.cmd");
      fs.writeFileSync(shim, "@echo off");
      expect(resolveExecutable("claude", "win32", dir, ".exe;.cmd")).toBe(shim);
    });

    it("prefers earlier PATHEXT entries", () => {
      fs.writeFileSync(path.join(dir, "tool.cmd"), "x");
      fs.writeFileSync(path.join(dir, "tool.exe"), "x");
      // path.delimiter on win32 is ';', but resolveExecutable uses the host
      // delimiter for splitting PATH — pass a single dir to avoid that nuance.
      const resolved = resolveExecutable("tool", "win32", dir, ".exe;.cmd");
      expect(resolved.endsWith("tool.exe")).toBe(true);
    });

    it("returns the original name when nothing matches (spawn surfaces ENOENT)", () => {
      expect(resolveExecutable("missing", "win32", dir, ".exe;.cmd")).toBe("missing");
    });

    it("leaves a name that already has an extension alone", () => {
      expect(resolveExecutable("git.exe", "win32", dir, ".exe;.cmd")).toBe("git.exe");
    });
  });
});
