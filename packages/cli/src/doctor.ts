import { commandExists } from "@localant/gateway";
import { c, ok, warn, fail } from "./util.js";

interface Check {
  name: string;
  required: boolean;
  pass: boolean;
  detail?: string;
}

/** Environment diagnostics for `doctor`. */
export async function runDoctor(): Promise<boolean> {
  const checks: Check[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ name: `Node.js ${process.version}`, required: true, pass: nodeMajor >= 20, detail: nodeMajor >= 22 ? "skill execution supported" : "Node 22+ recommended for skill execution" });
  checks.push({ name: `Platform ${process.platform}`, required: true, pass: true });

  const required = ["git", "node"];
  const optional = ["pnpm", "npm", "npx", "claude", "codex", "tailscale", "cloudflared", "ngrok", "adb", "docker", "bun"];
  for (const cmd of required) checks.push({ name: cmd, required: true, pass: await commandExists(cmd) });
  for (const cmd of optional) checks.push({ name: cmd, required: false, pass: await commandExists(cmd) });

  console.log(c.bold("\nEnvironment check\n"));
  let allRequired = true;
  for (const ch of checks) {
    const label = ch.detail ? `${ch.name} ${c.gray("— " + ch.detail)}` : ch.name;
    if (ch.pass) console.log(ok(label));
    else if (ch.required) {
      console.log(fail(`${label} ${c.red("(required, missing)")}`));
      allRequired = false;
    } else console.log(warn(`${label} ${c.gray("(optional, not found)")}`));
  }
  console.log("");
  if (!allRequired) console.log(fail("Some required tools are missing. Install them and re-run `doctor`."));
  else console.log(ok("All required tools present."));
  return allRequired;
}
