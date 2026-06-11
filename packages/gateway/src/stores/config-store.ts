import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ConfigSchema, type Config, defaultConfig, appPaths, type AppPaths } from "@localant/shared";

/** Loads, persists and initializes on-disk configuration and identity files. */
export class ConfigStore {
  readonly paths: AppPaths;

  constructor(base?: string) {
    this.paths = appPaths(base);
  }

  /** Create config dir tree and default files if missing. Idempotent. */
  ensureInitialized(): void {
    const p = this.paths;
    for (const dir of [p.root, path.dirname(p.auditLog), p.skillsDir, p.backupsDir, p.workspaceDir, p.logsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(p.configFile)) {
      const config = defaultConfig();
      config.tunnel.provider = "localtunnel";
      const rand = crypto.randomBytes(16).toString("hex");
      config.tunnel.subdomain = `localant-${rand}`;
      this.save(config);
    }
    if (!fs.existsSync(p.tokenFile)) {
      const token = crypto.randomBytes(32).toString("base64url");
      fs.writeFileSync(p.tokenFile, token, { mode: 0o600 });
    }
    if (!fs.existsSync(p.vaultKeyFile)) {
      // A dedicated, random 256-bit vault key kept independent of the auth
      // token, so rotating the token never makes stored secrets undecryptable.
      const key = crypto.randomBytes(32).toString("base64");
      fs.writeFileSync(p.vaultKeyFile, key, { mode: 0o600 });
    }
    if (!fs.existsSync(p.secretsFile)) {
      fs.writeFileSync(p.secretsFile, JSON.stringify({}), { mode: 0o600 });
    }
    if (!fs.existsSync(p.approvalsFile)) {
      fs.writeFileSync(p.approvalsFile, JSON.stringify([]), { mode: 0o600 });
    }
    if (!fs.existsSync(p.auditLog)) {
      fs.writeFileSync(p.auditLog, "", { mode: 0o600 });
    }
  }

  load(): Config {
    try {
      const raw = JSON.parse(fs.readFileSync(this.paths.configFile, "utf8"));
      const config = ConfigSchema.parse(raw);

      // Merge missing default coding agents into existing config automatically
      const def = defaultConfig();
      let changed = false;
      for (const [key, val] of Object.entries(def.codingAgents)) {
        if (!config.codingAgents[key]) {
          config.codingAgents[key] = val;
          changed = true;
        }
      }
      if (changed) {
        this.save(config);
      }

      return config;
    } catch {
      return defaultConfig();
    }
  }

  save(config: Config): Config {
    const parsed = ConfigSchema.parse(config);
    fs.writeFileSync(this.paths.configFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    return parsed;
  }

  /** Immutably merge a partial patch into config and persist. */
  update(patch: Partial<Config>): Config {
    const current = this.load();
    return this.save({ ...current, ...patch });
  }

  getToken(): string {
    return fs.readFileSync(this.paths.tokenFile, "utf8").trim();
  }

  /** Read the dedicated vault key (base64). Independent of the auth token. */
  getVaultKey(): Buffer {
    return Buffer.from(fs.readFileSync(this.paths.vaultKeyFile, "utf8").trim(), "base64");
  }

  /**
   * Generate a fresh auth token and persist it. Returns the new token. Because
   * the vault key is stored separately, rotating the token does NOT invalidate
   * stored secrets.
   */
  rotateToken(): string {
    const token = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(this.paths.tokenFile, token, { mode: 0o600 });
    return token;
  }
}
