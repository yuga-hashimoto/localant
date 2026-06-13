import { commandExists, resolveTailscale } from "@localant/gateway";
import { c, ok, warn, fail } from "./util.js";
import { checkOptionalDeps, printOptionalDeps, type OptionalDepStatus } from "./optional-deps.js";

interface Check {
  name: string;
  required: boolean;
  pass: boolean;
  detail?: string;
}

export interface DoctorReport {
  ok: boolean;
  node: string;
  platform: string;
  checks: Check[];
  optionalDeps: OptionalDepStatus[];
}

/** Gather environment diagnostics without printing anything. */
export async function collectDoctor(): Promise<DoctorReport> {
  const checks: Check[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: `Node.js ${process.version}`,
    required: true,
    pass: nodeMajor >= 20,
    detail: nodeMajor >= 22 ? "skill execution supported" : "Node 22+ recommended for skill execution",
  });
  checks.push({ name: `Platform ${process.platform}`, required: true, pass: true });

  const required = ["git", "node"];
  // tailscale is resolved separately: on macOS the GUI build ships the CLI in
  // the app bundle and isn't on PATH, so a bare commandExists would lie.
  const optional = ["pnpm", "npm", "npx", "claude", "codex", "cloudflared", "ngrok", "adb", "docker", "bun"];
  for (const cmd of required) checks.push({ name: cmd, required: true, pass: await commandExists(cmd) });
  checks.push({ name: "tailscale", required: false, pass: (await resolveTailscale()) !== null });
  for (const cmd of optional) checks.push({ name: cmd, required: false, pass: await commandExists(cmd) });

  const allRequired = checks.every((ch) => !ch.required || ch.pass);
  return {
    ok: allRequired,
    node: process.version,
    platform: process.platform,
    checks,
    optionalDeps: await checkOptionalDeps(),
  };
}

/** Environment diagnostics for `doctor`. Returns true when all required tools
 * are present. With `{ json: true }`, prints a single machine-readable object. */
export async function runDoctor(opts: { json?: boolean } = {}): Promise<boolean> {
  const report = await collectDoctor();

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok;
  }

  console.log(c.bold("\nEnvironment check\n"));
  for (const ch of report.checks) {
    const label = ch.detail ? `${ch.name} ${c.gray("— " + ch.detail)}` : ch.name;
    if (ch.pass) console.log(ok(label));
    else if (ch.required) console.log(fail(`${label} ${c.red("(required, missing)")}`));
    else console.log(warn(`${label} ${c.gray("(optional, not found)")}`));
  }
  console.log("");
  if (!report.ok) console.log(fail("Some required tools are missing. Install them and re-run `doctor`."));
  else console.log(ok("All required tools present."));

  printOptionalDeps(report.optionalDeps);
  return report.ok;
}
