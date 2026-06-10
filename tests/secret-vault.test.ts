import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { appPaths } from "@localant/shared";
import { SecretVault } from "@localant/gateway";

let base: string;
function paths() {
  return appPaths(base);
}
function newKey(): Buffer {
  return crypto.randomBytes(32);
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-vault-"));
  fs.writeFileSync(paths().secretsFile, JSON.stringify({}), { mode: 0o600 });
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("SecretVault", () => {
  it("round-trips a stored value through encryption", () => {
    const v = new SecretVault(paths(), newKey());
    v.set("API_KEY", "super-secret-value");
    expect(v.get("API_KEY")).toBe("super-secret-value");
  });

  it("never writes plaintext to disk", () => {
    const v = new SecretVault(paths(), newKey());
    v.set("API_KEY", "plaintext-needle");
    const onDisk = fs.readFileSync(paths().secretsFile, "utf8");
    expect(onDisk).not.toContain("plaintext-needle");
  });

  it("lists names but never values", () => {
    const v = new SecretVault(paths(), newKey());
    v.set("A", "valueA");
    v.set("B", "valueB");
    expect(v.list()).toEqual(["A", "B"]);
    expect(JSON.stringify(v.list())).not.toContain("valueA");
  });

  it("removes a secret", () => {
    const v = new SecretVault(paths(), newKey());
    v.set("A", "x");
    expect(v.remove("A")).toBe(true);
    expect(v.get("A")).toBeUndefined();
    expect(v.remove("A")).toBe(false);
  });

  it("cannot decrypt with a different key", () => {
    const k1 = newKey();
    new SecretVault(paths(), k1).set("A", "x");
    const wrong = new SecretVault(paths(), newKey());
    expect(wrong.get("A")).toBeUndefined();
  });

  it("reads legacy token-derived secrets and migrates them to the dedicated key", () => {
    const token = "legacy-auth-token";
    // Old version: key derived from the auth token.
    const legacyKey = crypto.createHash("sha256").update(`cla-vault:${token}`).digest();
    new SecretVault(paths(), legacyKey).set("OLD", "legacy-value");

    // New version: dedicated key + legacy token for migration.
    const dedicated = newKey();
    const v = new SecretVault(paths(), dedicated, token);
    expect(v.get("OLD")).toBe("legacy-value");

    const migrated = v.migrate();
    expect(migrated).toBe(1);

    // After migration the secret decrypts under the dedicated key alone.
    const withoutLegacy = new SecretVault(paths(), dedicated);
    expect(withoutLegacy.get("OLD")).toBe("legacy-value");
  });

  it("migrate is idempotent and a no-op without a legacy key", () => {
    const v = new SecretVault(paths(), newKey());
    v.set("A", "x");
    expect(v.migrate()).toBe(0);
  });
});
