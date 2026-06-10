import fs from "node:fs";
import crypto from "node:crypto";
import type { AppPaths } from "@localant/shared";

/**
 * Local secret vault. Values are encrypted at rest with AES-256-GCM using a
 * dedicated random vault key stored separately from the auth token (see
 * ConfigStore.getVaultKey). This means rotating the auth token never makes
 * stored secrets undecryptable. Secret *values* are never returned by listing
 * operations and never logged.
 *
 * For backward compatibility, a `legacyToken` may be supplied: secrets written
 * by older versions (which derived the key from the auth token) are decrypted
 * with the legacy key on read and transparently re-encrypted with the dedicated
 * key via {@link migrate}.
 */
export class SecretVault {
  private readonly file: string;
  private readonly key: Buffer;
  private readonly legacyKey?: Buffer;

  constructor(paths: AppPaths, key: Buffer, legacyToken?: string) {
    this.file = paths.secretsFile;
    this.key = key;
    this.legacyKey = legacyToken
      ? crypto.createHash("sha256").update(`cla-vault:${legacyToken}`).digest()
      : undefined;
  }

  private read(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private write(data: Record<string, string>): void {
    fs.writeFileSync(this.file, JSON.stringify(data), { mode: 0o600 });
  }

  private encrypt(value: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
  }

  private decryptWith(blob: string, key: Buffer): string | undefined {
    try {
      const [ivB, tagB, encB] = blob.split(".");
      if (!ivB || !tagB || !encB) return undefined;
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
      decipher.setAuthTag(Buffer.from(tagB, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  }

  /** Decrypt with the current key, falling back to the legacy token-derived key. */
  private decrypt(blob: string): string | undefined {
    const primary = this.decryptWith(blob, this.key);
    if (primary !== undefined) return primary;
    return this.legacyKey ? this.decryptWith(blob, this.legacyKey) : undefined;
  }

  set(name: string, value: string): void {
    const data = this.read();
    data[name] = this.encrypt(value);
    this.write(data);
  }

  get(name: string): string | undefined {
    const blob = this.read()[name];
    return blob ? this.decrypt(blob) : undefined;
  }

  remove(name: string): boolean {
    const data = this.read();
    if (!(name in data)) return false;
    delete data[name];
    this.write(data);
    return true;
  }

  /** Names only — never values. */
  list(): string[] {
    return Object.keys(this.read()).sort();
  }

  /** All current secret values, for redaction purposes only. */
  allValues(): string[] {
    return Object.keys(this.read())
      .map((k) => this.get(k))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }

  /**
   * Re-encrypt any secrets that only decrypt under the legacy token-derived key
   * with the dedicated vault key. Idempotent; a no-op when there is no legacy
   * key or nothing needs migrating. Returns the number of secrets migrated.
   */
  migrate(): number {
    if (!this.legacyKey) return 0;
    const data = this.read();
    let migrated = 0;
    for (const [name, blob] of Object.entries(data)) {
      if (this.decryptWith(blob, this.key) !== undefined) continue; // already current
      const legacy = this.decryptWith(blob, this.legacyKey);
      if (legacy !== undefined) {
        data[name] = this.encrypt(legacy);
        migrated++;
      }
    }
    if (migrated > 0) this.write(data);
    return migrated;
  }
}
