import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configDir, migrateLegacyConfigDir } from "@localant/shared";

const ORIGINAL = process.env.LOCALANT_HOME;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LOCALANT_HOME;
  else process.env.LOCALANT_HOME = ORIGINAL;
});

describe("configDir", () => {
  it("defaults to ~/.localant on every platform", () => {
    delete process.env.LOCALANT_HOME;
    expect(configDir()).toBe(path.join(os.homedir(), ".localant"));
  });

  it("honors the LOCALANT_HOME override", () => {
    process.env.LOCALANT_HOME = "/tmp/custom-localant";
    expect(configDir()).toBe(path.resolve("/tmp/custom-localant"));
  });
});

describe("migrateLegacyConfigDir", () => {
  it("does not clobber an existing target directory", () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests-paths-"));
    try {
      // target exists → migration is a no-op and returns false.
      expect(migrateLegacyConfigDir(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
