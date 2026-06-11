import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_VERSION } from "@localant/shared";

describe("APP_VERSION", () => {
  it("matches the root package.json version (no manual sync needed)", () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { name: string; version: string };
    expect(rootPkg.name).toBe("localant");
    expect(APP_VERSION).toBe(rootPkg.version);
  });

  it("is a non-empty semver-ish string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_VERSION).not.toBe("0.0.0");
  });
});
