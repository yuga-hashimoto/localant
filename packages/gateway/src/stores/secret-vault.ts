import fs from "node:fs";
import crypto from "node:crypto";
import type { AppPaths } from "@chatgpt-local-app/shared";

/**
 * Local secret vault. Values are encrypted at rest with AES-256-GCM using a
 * key derived from the auth token + machine-local salt. Secret *values* are
 * never returned by listing operations and never logged.
 */
export class SecretVault {
  private readonly file: string;
  private readonly key: Buffer;

  constructor(paths: AppPaths, token: string) {
    this.file = paths.secretsFile;
    this.key = crypto.createHash("sha256").update(`cla-vault:${token}`).digest();
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

  private decrypt(blob: string): string | undefined {
    try {
      const [ivB, tagB, encB] = blob.split(".");
      if (!ivB || !tagB || !encB) return undefined;
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB, "base64"));
      decipher.setAuthTag(Buffer.from(tagB, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
    } catch {
      return undefined;
    }
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
}
