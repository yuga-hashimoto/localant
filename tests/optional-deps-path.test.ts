import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { optionalDepsDir, resolveOptionalDep } from "@localant/gateway";

const ORIGINAL = process.env.LOCALANT_HOME;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LOCALANT_HOME;
  else process.env.LOCALANT_HOME = ORIGINAL;
});

describe("optionalDepsDir", () => {
  it("defaults to ~/.localant/optional-deps", () => {
    delete process.env.LOCALANT_HOME;
    expect(optionalDepsDir()).toBe(path.join(os.homedir(), ".localant", "optional-deps"));
  });

  it("honors the LOCALANT_HOME override so it never lands in the cwd", () => {
    process.env.LOCALANT_HOME = "/tmp/custom-localant";
    expect(optionalDepsDir()).toBe(path.join(path.resolve("/tmp/custom-localant"), "optional-deps"));
  });
});

describe("resolveOptionalDep", () => {
  it("returns null when the package is not installed in the deps dir", () => {
    process.env.LOCALANT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "localant-deps-"));
    try {
      expect(resolveOptionalDep("a-package-that-does-not-exist-xyz")).toBeNull();
    } finally {
      fs.rmSync(process.env.LOCALANT_HOME, { recursive: true, force: true });
    }
  });

  it("resolves a package installed under the deps dir's node_modules", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "localant-deps-"));
    process.env.LOCALANT_HOME = home;
    const depsDir = path.join(home, "optional-deps");
    // Simulate a package installed by `localant deps install` into the isolated dir.
    const pkgDir = path.join(depsDir, "node_modules", "fake-pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "fake-pkg", version: "1.0.0", main: "index.js" }));
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");
    try {
      // require.resolve returns a realpath, so normalize both sides (macOS
      // symlinks /var → /private/var under the temp dir).
      const expected = fs.realpathSync(path.join(pkgDir, "index.js"));
      expect(resolveOptionalDep("fake-pkg")).toBe(expected);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
