import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PathGuard, PathAccessError } from "@localant/gateway";

let root: string;
let allowed: string;

beforeEach(() => {
  // Use a repo-local temp dir: the OS tmpdir on macOS lives under /var, which
  // is (correctly) in the sensitive blocklist.
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-pg-"));
  allowed = path.join(root, "allowed");
  fs.mkdirSync(allowed, { recursive: true });
  fs.writeFileSync(path.join(allowed, "file.txt"), "hi");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("PathGuard", () => {
  it("allows access inside an allowed directory", () => {
    const g = new PathGuard([allowed]);
    expect(g.assertAccess(path.join(allowed, "file.txt"), "read")).toContain("file.txt");
  });

  it("rejects access outside allowed directories", () => {
    const g = new PathGuard([allowed]);
    expect(() => g.assertAccess(path.join(root, "outside.txt"), "read")).toThrow(PathAccessError);
  });

  it("rejects path traversal escaping the allowlist", () => {
    const g = new PathGuard([allowed]);
    expect(() => g.assertAccess(path.join(allowed, "..", "secret.txt"), "read")).toThrow(PathAccessError);
  });

  // Creating symlinks on Windows requires elevated privileges in CI.
  it.skipIf(process.platform === "win32")("rejects symlink traversal out of the allowlist", () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    const link = path.join(allowed, "escape");
    fs.symlinkSync(outside, link);
    const g = new PathGuard([allowed]);
    expect(() => g.assertAccess(path.join(link, "secret.txt"), "read")).toThrow(/symlink/i);
  });

  it("rejects sensitive blocklist paths", () => {
    const g = new PathGuard([os.homedir()]);
    expect(() => g.assertAccess(path.join(os.homedir(), ".ssh", "id_rsa"), "read")).toThrow(/blocklist/i);
  });
});
