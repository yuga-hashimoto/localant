import { PathGuard } from "../security/path-guard.js";
import { execFileSafe } from "../util/exec.js";

/** Git operations executed via execFile (no shell) inside allowed dirs. */
export class GitManager {
  constructor(private readonly guard: PathGuard) {}

  private async git(repo: string, args: string[]): Promise<string> {
    const cwd = this.guard.assertAccess(repo, "read");
    const res = await execFileSafe("git", args, { cwd, timeoutMs: 60_000, maxOutputBytes: 200_000 });
    if (res.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`.trim());
    }
    return res.stdout;
  }

  status(repo: string): Promise<string> {
    return this.git(repo, ["status", "--short", "--branch"]);
  }
  diff(repo: string): Promise<string> {
    return this.git(repo, ["diff"]);
  }
  diffFile(repo: string, file: string): Promise<string> {
    return this.git(repo, ["diff", "--", file]);
  }
  listChangedFiles(repo: string): Promise<string> {
    return this.git(repo, ["status", "--porcelain"]);
  }
  branch(repo: string): Promise<string> {
    return this.git(repo, ["branch", "--all"]);
  }
  log(repo: string, n = 20): Promise<string> {
    return this.git(repo, ["log", `-n${n}`, "--oneline", "--decorate"]);
  }
  createPatch(repo: string): Promise<string> {
    return this.git(repo, ["diff", "--patch"]);
  }

  // --- mutating (risk >= 2/3) ---
  createBranch(repo: string, name: string): Promise<string> {
    assertRef(name);
    return this.git(repo, ["checkout", "-b", name]);
  }
  checkoutBranch(repo: string, name: string): Promise<string> {
    assertRef(name);
    return this.git(repo, ["checkout", name]);
  }
  async commit(repo: string, message: string, addAll: boolean): Promise<string> {
    if (addAll) await this.git(repo, ["add", "-A"]);
    return this.git(repo, ["commit", "-m", message]);
  }
  restoreFile(repo: string, file: string): Promise<string> {
    return this.git(repo, ["restore", "--", file]);
  }

  async isDirty(repo: string): Promise<boolean> {
    const out = await this.listChangedFiles(repo);
    return out.trim().length > 0;
  }

  async currentBranch(repo: string): Promise<string> {
    return (await this.git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  }
}

function assertRef(name: string): void {
  if (!/^[A-Za-z0-9._\/-]+$/.test(name) || name.startsWith("-")) {
    throw new Error(`Invalid git ref name: ${name}`);
  }
}
