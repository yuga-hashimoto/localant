import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ConfigSchema, type Config, defaultConfig, appPaths, type AppPaths } from "@chatgpt-local-app/shared";

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
      this.save(defaultConfig());
    }
    if (!fs.existsSync(p.tokenFile)) {
      const token = crypto.randomBytes(32).toString("base64url");
      fs.writeFileSync(p.tokenFile, token, { mode: 0o600 });
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
      return ConfigSchema.parse(raw);
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
}
