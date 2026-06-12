import path from "node:path";
import { createRequire } from "node:module";
import { configDir } from "@localant/shared";

/**
 * Heavy optional dependencies (Playwright …) are installed into a dedicated
 * directory under the LocalAnt config home — never the current working
 * directory.
 *
 * Running `npm install` in the cwd breaks whenever that directory (or a parent)
 * is a pnpm/yarn workspace, because npm cannot parse `workspace:*` protocol
 * deps. Installing into an isolated dir with its own minimal `package.json`
 * keeps the install self-contained and reproducible regardless of where the
 * user invoked `localant deps install` from.
 */
export function optionalDepsDir(): string {
  return path.join(configDir(), "optional-deps");
}

/**
 * Resolve a module from the isolated optional-deps directory. Returns the
 * resolved entry path, or null when the package is not installed there.
 */
export function resolveOptionalDep(name: string): string | null {
  try {
    // A require anchored inside the deps dir resolves its node_modules tree.
    const requireFromDeps = createRequire(path.join(optionalDepsDir(), "noop.cjs"));
    return requireFromDeps.resolve(name);
  } catch {
    return null;
  }
}
