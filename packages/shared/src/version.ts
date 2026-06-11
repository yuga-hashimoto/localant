import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Single source of truth for the application version — resolved at runtime from
 * the root `localant` `package.json` so it never drifts and needs no manual
 * sync on release. Works in dev (workspace `src`), built `dist`, and the
 * published package (`node_modules/localant/...`): we walk up from this module
 * until we find the `package.json` whose `name` is `localant`.
 */
function resolveAppVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "localant" && typeof pkg.version === "string") return pkg.version;
      } catch {
        /* no readable package.json at this level — keep walking up */
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through to the sentinel below */
  }
  return "0.0.0";
}

export const APP_VERSION: string = resolveAppVersion();
