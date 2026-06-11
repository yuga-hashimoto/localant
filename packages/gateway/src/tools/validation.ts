import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Gateway } from "../gateway.js";

/** Resolve a project id or raw path to a filesystem path. */
function resolvePath(gw: Gateway, idOrPath: string): string {
  const project = gw.projects.get(idOrPath);
  return project ? project.path : idOrPath;
}

/** Detect the package manager from lockfiles (pnpm > bun > yarn > npm). */
function detectPackageManager(dir: string): "pnpm" | "bun" | "yarn" | "npm" {
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("bun.lockb") || has("bun.lock")) return "bun";
  if (has("yarn.lock")) return "yarn";
  return "npm";
}

interface PackageInfo {
  scripts: Record<string, string>;
  packageManager: "pnpm" | "bun" | "yarn" | "npm";
}

function readPackage(gw: Gateway, dir: string): PackageInfo {
  const pkgPath = path.join(dir, "package.json");
  let scripts: Record<string, string> = {};
  try {
    const raw = gw.fs.readFile(pkgPath);
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    scripts = parsed.scripts ?? {};
  } catch {
    /* no package.json or unreadable */
  }
  return { scripts, packageManager: detectPackageManager(dir) };
}

/** Pick the first script name that exists from a list of candidates. */
function pickScript(scripts: Record<string, string>, candidates: string[]): string | undefined {
  return candidates.find((c) => c in scripts);
}

async function runScript(
  gw: Gateway,
  dir: string,
  pm: PackageInfo["packageManager"],
  script: string,
): Promise<unknown> {
  const command = `${pm} run ${script}`;
  const res = await gw.shell.runBash(command, { cwd: dir });
  return { command: res.command, code: res.code, stdout: res.stdout, stderr: res.stderr, durationMs: res.durationMs };
}

export function registerValidationTools(gw: Gateway): void {
  const r = gw.registry;
  const projArg = z.object({ projectId: z.string().describe("Project id/name or path") });

  r.register({
    name: "project_get_package_scripts",
    description: "Read package.json scripts and detect the package manager for a project.",
    risk: 0,
    inputSchema: projArg,
    handler: (i) => {
      const dir = resolvePath(gw, i.projectId);
      return { path: dir, ...readPackage(gw, dir) };
    },
  });

  r.register({
    name: "project_install_deps",
    description: "Install project dependencies using the detected package manager.",
    risk: 3,
    inputSchema: projArg,
    summarize: (i) => `install deps ${i.projectId}`,
    handler: async (i) => {
      const dir = resolvePath(gw, i.projectId);
      const pm = detectPackageManager(dir);
      const res = await gw.shell.runBash(`${pm} install`, { cwd: dir });
      return { command: res.command, code: res.code, stdout: res.stdout, stderr: res.stderr };
    },
  });

  const runner = (
    name: string,
    description: string,
    candidates: string[],
  ): void => {
    r.register({
      name,
      description,
      risk: 3,
      inputSchema: projArg,
      summarize: (i) => `${name} ${i.projectId}`,
      handler: async (i) => {
        const dir = resolvePath(gw, i.projectId);
        const info = readPackage(gw, dir);
        const script = pickScript(info.scripts, candidates);
        if (!script) {
          return { error: `No matching script found (looked for: ${candidates.join(", ")}).`, scripts: info.scripts };
        }
        return runScript(gw, dir, info.packageManager, script);
      },
    });
  };

  runner("project_run_tests", "Run the project's test script.", ["test", "tests"]);
  runner("project_run_lint", "Run the project's lint script.", ["lint", "eslint"]);
  runner("project_run_typecheck", "Run the project's typecheck script.", ["typecheck", "type-check", "tsc"]);
  runner("project_run_format", "Run the project's format script.", ["format", "fmt", "prettier"]);
  runner("project_run_build", "Run the project's build script.", ["build", "compile"]);

  r.register({
    name: "project_run_validation",
    description:
      "Run the project's validation. Uses the configured validateCommand if set, else the 'validate' script, else build+test.",
    risk: 3,
    inputSchema: projArg,
    summarize: (i) => `validate ${i.projectId}`,
    handler: async (i) => {
      const project = gw.projects.get(i.projectId);
      const dir = project ? project.path : i.projectId;
      if (project?.validateCommand) {
        const res = await gw.shell.runBash(project.validateCommand, { cwd: dir });
        return { command: res.command, code: res.code, stdout: res.stdout, stderr: res.stderr };
      }
      const info = readPackage(gw, dir);
      const script = pickScript(info.scripts, ["validate"]);
      if (script) return runScript(gw, dir, info.packageManager, script);
      // Fallback: build then test.
      const results: unknown[] = [];
      for (const s of ["build", "test"]) {
        if (s in info.scripts) results.push(await runScript(gw, dir, info.packageManager, s));
      }
      if (results.length === 0) return { error: "No validate/build/test script found.", scripts: info.scripts };
      return { steps: results };
    },
  });
}
