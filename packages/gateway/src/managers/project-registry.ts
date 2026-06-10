import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AppPaths, ProjectRecord } from "@localant/shared";
import { PathGuard } from "../security/path-guard.js";

/** Registry of known local projects. Paths must be inside allowed dirs. */
export class ProjectRegistry {
  private readonly file: string;

  constructor(
    paths: AppPaths,
    private readonly guard: PathGuard,
  ) {
    this.file = path.join(paths.root, "projects.json");
  }

  private read(): ProjectRecord[] {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as ProjectRecord[];
    } catch {
      return [];
    }
  }
  private write(items: ProjectRecord[]): void {
    fs.writeFileSync(this.file, JSON.stringify(items, null, 2), { mode: 0o600 });
  }

  list(): ProjectRecord[] {
    return this.read();
  }
  get(id: string): ProjectRecord | undefined {
    return this.read().find((p) => p.id === id || p.name === id);
  }

  register(projectPath: string, name?: string): ProjectRecord {
    const resolved = this.guard.assertAccess(projectPath, "read");
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a directory: ${projectPath}`);
    }
    const items = this.read();
    const existing = items.find((p) => p.path === resolved);
    if (existing) return existing;
    const record: ProjectRecord = {
      id: nanoid(8),
      name: name ?? path.basename(resolved),
      path: resolved,
      registeredAt: new Date().toISOString(),
      stack: this.detectStack(resolved),
      defaultBranch: "main",
    };
    items.push(record);
    this.write(items);
    return record;
  }

  unregister(id: string): boolean {
    const items = this.read();
    const next = items.filter((p) => p.id !== id && p.name !== id);
    if (next.length === items.length) return false;
    this.write(next);
    return true;
  }

  update(id: string, patch: Partial<ProjectRecord>): ProjectRecord {
    const items = this.read();
    const idx = items.findIndex((p) => p.id === id || p.name === id);
    if (idx === -1) throw new Error(`Project not found: ${id}`);
    const updated = { ...items[idx]!, ...patch, id: items[idx]!.id, path: items[idx]!.path };
    items[idx] = updated;
    this.write(items);
    return updated;
  }

  detectStack(dir: string): string[] {
    const stack: string[] = [];
    const has = (f: string) => fs.existsSync(path.join(dir, f));
    if (has("package.json")) stack.push("node");
    if (has("pnpm-lock.yaml")) stack.push("pnpm");
    if (has("tsconfig.json")) stack.push("typescript");
    if (has("Cargo.toml")) stack.push("rust");
    if (has("go.mod")) stack.push("go");
    if (has("requirements.txt") || has("pyproject.toml")) stack.push("python");
    if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) stack.push("jvm");
    if (has("Gemfile")) stack.push("ruby");
    return stack;
  }
}
