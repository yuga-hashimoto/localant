import os from "node:os";
import path from "node:path";

const APP_NAME = "LocalAnt";

/**
 * Resolve the per-OS configuration directory.
 * - macOS:   ~/Library/Application Support/LocalAnt
 * - Windows: %APPDATA%/LocalAnt
 * - Linux:   $XDG_CONFIG_HOME/LocalAnt or ~/.config/LocalAnt
 */
export function configDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_NAME);
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_NAME);
    default: {
      const xdg = process.env.XDG_CONFIG_HOME;
      return path.join(xdg && xdg.trim() ? xdg : path.join(home, ".config"), APP_NAME);
    }
  }
}

export interface AppPaths {
  root: string;
  configFile: string;
  tokenFile: string;
  vaultKeyFile: string;
  auditLog: string;
  approvalsFile: string;
  secretsFile: string;
  pidFile: string;
  runtimeFile: string;
  skillsDir: string;
  backupsDir: string;
  workspaceDir: string;
  logsDir: string;
}

export function appPaths(base = configDir()): AppPaths {
  return {
    root: base,
    configFile: path.join(base, "config.json"),
    tokenFile: path.join(base, "token"),
    vaultKeyFile: path.join(base, "vault.key"),
    auditLog: path.join(base, "audit", "audit.jsonl"),
    approvalsFile: path.join(base, "approvals.json"),
    secretsFile: path.join(base, "secrets.json"),
    pidFile: path.join(base, "gateway.pid"),
    runtimeFile: path.join(base, "runtime.json"),
    skillsDir: path.join(base, "skills"),
    backupsDir: path.join(base, "backups"),
    workspaceDir: path.join(base, "workspace"),
    logsDir: path.join(base, "logs"),
  };
}

export function defaultAllowedDirectories(): string[] {
  const home = os.homedir();
  return [
    path.join(home, "Projects"),
    path.join(home, "Developer"),
    path.join(home, "Documents"),
  ];
}

/**
 * Paths that must never be readable or writable regardless of allowlist.
 * Matched as path prefixes after normalization.
 */
export function sensitiveBlocklist(): string[] {
  const home = os.homedir();
  const common = [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, ".aws"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".npmrc"),
    path.join(home, ".netrc"),
  ];
  if (process.platform === "darwin") {
    return [...common, path.join(home, "Library", "Keychains"), "/private", "/etc", "/var", "/System"];
  }
  if (process.platform === "win32") {
    return [...common, "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"];
  }
  return [...common, "/etc", "/var", "/sys", "/proc", "/boot"];
}

export const APP_DISPLAY_NAME = APP_NAME;
