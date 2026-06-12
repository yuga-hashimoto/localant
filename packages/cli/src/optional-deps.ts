import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { commandExists } from "@localant/gateway";
import { c, ok, warn } from "./util.js";

/**
 * Optional capability dependencies.
 *
 * The base install is deliberately light: browser automation (Playwright) and
 * desktop mouse/keyboard control (cliclick) pull in large or platform-specific
 * binaries, so they are NOT installed by default. The tools that need them
 * already fail with an install hint at call time; this module surfaces the same
 * gaps up front (`doctor`) and offers to fill them during `setup`.
 */
export interface OptionalDep {
  /** Stable id used in flags / prompts. */
  id: string;
  /** Human label for the capability this unlocks. */
  capability: string;
  /** Tools that stop working when this dependency is missing. */
  tools: string;
  /** True when this dependency is installable on the current platform. */
  supported: boolean;
  /** Resolve whether the dependency is currently available. */
  check: () => Promise<boolean>;
  /** Install it (throws on failure). */
  install: () => void;
  /** Manual instructions shown when auto-install is unavailable. */
  manualHint: string;
}

const requireFromHere = createRequire(import.meta.url);

/** True when the `playwright` package can be resolved from the install. */
function playwrightInstalled(): boolean {
  try {
    requireFromHere.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

export const OPTIONAL_DEPS: readonly OptionalDep[] = [
  {
    id: "browser",
    capability: "Browser automation",
    tools: "browser_* (open, screenshot, extract_text, …)",
    supported: true,
    check: async () => playwrightInstalled(),
    install: () => {
      // Install Playwright next to the CLI, then fetch the Chromium binary.
      execFileSync("npm", ["install", "playwright"], { stdio: "inherit" });
      execFileSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
    },
    manualHint: "npm i playwright && npx playwright install chromium",
  },
  {
    id: "desktop",
    capability: "Desktop mouse/keyboard control",
    tools: "computer_* click/type/drag/key/scroll",
    supported: process.platform === "darwin",
    check: async () => commandExists("cliclick"),
    install: () => {
      execFileSync("brew", ["install", "cliclick"], { stdio: "inherit" });
    },
    manualHint:
      "brew install cliclick — then grant Accessibility permission " +
      "(System Settings → Privacy & Security → Accessibility) to the app running LocalAnt.",
  },
];

export interface OptionalDepStatus extends OptionalDep {
  installed: boolean;
}

/** Resolve the current install state of every optional capability dependency. */
export async function checkOptionalDeps(): Promise<OptionalDepStatus[]> {
  return Promise.all(
    OPTIONAL_DEPS.map(async (dep) => ({ ...dep, installed: dep.supported ? await dep.check() : false })),
  );
}

/**
 * Attempt to install a single optional dependency. Returns true on success.
 * Best-effort: failures are reported with the manual fallback and never throw.
 */
export function tryInstallOptionalDep(dep: OptionalDep): boolean {
  try {
    dep.install();
    return true;
  } catch {
    console.log(warn(`Could not install ${dep.capability} automatically. Install it manually:`));
    console.log(c.gray(`   ${dep.manualHint}`));
    return false;
  }
}

/** Print the optional-capability section for `doctor`. */
export function printOptionalDeps(statuses: OptionalDepStatus[]): void {
  console.log(c.bold("\nOptional capabilities\n"));
  for (const s of statuses) {
    const label = `${s.capability} ${c.gray("— " + s.tools)}`;
    if (!s.supported) {
      console.log(warn(`${label} ${c.gray("(not supported on this platform)")}`));
    } else if (s.installed) {
      console.log(ok(label));
    } else {
      console.log(warn(`${label} ${c.gray("(not installed — enable with: localant deps install " + s.id + ")")}`));
    }
  }
}
