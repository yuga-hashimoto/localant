#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { createGateway } from "@localant/gateway";
import { c, ok, warn, fail, openBrowser } from "./util.js";
import { runGateway, type StartOptions } from "./runtime.js";
import { runDoctor } from "./doctor.js";

const program = new Command();
program.name("LocalAnt").description("Use ChatGPT as the brain and your local computer as the hands.").version("1.0.0");

function startOpts(o: Record<string, unknown>): StartOptions {
  // Commander stores `--no-tunnel` etc. as `tunnel: false` (default true), so we
  // invert those flags here rather than reading non-existent `noTunnel` keys.
  return {
    noTunnel: o.tunnel === false,
    noOpen: o.open === false,
    noClipboard: o.clipboard === false,
    quiet: Boolean(o.quiet),
  };
}

program
  .command("setup")
  .description("First-time setup: init config, start gateway, dashboard and tunnel")
  .option("--no-tunnel", "do not start a public tunnel")
  .option("--no-open", "do not open the dashboard in a browser")
  .option("--no-clipboard", "do not copy the MCP URL to the clipboard")
  .action(async (o) => {
    console.log(c.bold("Setting up LocalAnt…\n"));
    await runDoctor();
    const gw = createGateway();
    console.log("");
    console.log(ok(`Config: ${gw.paths.root}`));
    console.log(ok("Auth token generated"));
    console.log(ok(`Skills: ${gw.skills.list().length} available`));
    ensureWorkspace(gw.paths.workspaceDir);
    await runGateway(gw, startOpts(o));
  });

program
  .command("start")
  .description("Start the gateway, dashboard and tunnel")
  .option("--no-tunnel", "do not start a public tunnel")
  .option("--no-open", "do not open the dashboard")
  .option("--quiet", "minimal output")
  .action(async (o) => {
    const gw = createGateway();
    await runGateway(gw, startOpts(o));
  });

program
  .command("stop")
  .description("Stop a running gateway (via PID file)")
  .action(() => {
    const gw = createGateway();
    if (!fs.existsSync(gw.paths.pidFile)) return console.log(warn("No running gateway found."));
    const pid = Number(fs.readFileSync(gw.paths.pidFile, "utf8").trim());
    try {
      process.kill(pid, "SIGTERM");
      console.log(ok(`Sent SIGTERM to pid ${pid}`));
    } catch {
      console.log(warn(`Process ${pid} not running. Cleaning up.`));
      fs.rmSync(gw.paths.pidFile, { force: true });
    }
  });

program
  .command("restart")
  .description("Restart the gateway")
  .action(async () => {
    const gw = createGateway();
    if (fs.existsSync(gw.paths.pidFile)) {
      const pid = Number(fs.readFileSync(gw.paths.pidFile, "utf8").trim());
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    await runGateway(createGateway(), {});
  });

program
  .command("status")
  .description("Show gateway status")
  .action(() => {
    const gw = createGateway();
    if (!fs.existsSync(gw.paths.runtimeFile)) return console.log(warn("Gateway has not been started yet."));
    const rt = JSON.parse(fs.readFileSync(gw.paths.runtimeFile, "utf8"));
    let alive = false;
    if (fs.existsSync(gw.paths.pidFile)) {
      const pid = Number(fs.readFileSync(gw.paths.pidFile, "utf8").trim());
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    console.log(alive ? ok("Gateway is running") : warn("Gateway is not running (stale runtime info shown)"));
    console.log(`  Gateway:   ${c.cyan(rt.gateway)}`);
    console.log(`  Dashboard: ${c.cyan(rt.dashboard ?? "(disabled)")}`);
    console.log(`  MCP URL:   ${c.cyan(rt.mcpEndpoint ?? "(tunnel off)")}`);
  });

program.command("doctor").description("Check the environment").action(async () => {
  const passed = await runDoctor();
  process.exit(passed ? 0 : 1);
});

program.command("update").description("How to update").action(() => {
  console.log("Update with:");
  console.log(c.cyan("  npm install -g LocalAnt@latest"));
});

program
  .command("uninstall")
  .description("Show uninstall steps; --purge also deletes the config directory")
  .option("--purge", "delete the config/data directory")
  .action((o) => {
    const gw = createGateway();
    console.log("To uninstall the package:");
    console.log(c.cyan("  npm uninstall -g LocalAnt"));
    if (o.purge) {
      fs.rmSync(gw.paths.root, { recursive: true, force: true });
      console.log(ok(`Deleted ${gw.paths.root}`));
    } else {
      console.log(`Config/data lives at: ${c.cyan(gw.paths.root)}`);
      console.log("Re-run with --purge to delete it.");
    }
  });

program.command("dashboard").description("Open the local dashboard").action(() => {
  const gw = createGateway();
  const url = `http://127.0.0.1:${gw.config().dashboard.port}`;
  openBrowser(url);
  console.log(ok(`Opening ${url}`));
});

program.command("logs").description("Show recent audit log entries").option("-n, --num <n>", "number of entries", "30").action((o) => {
  const gw = createGateway();
  for (const e of gw.audit.list(Number(o.num)).reverse()) {
    console.log(`${c.gray(e.timestamp.slice(0, 19))} ${c.bold(e.tool)} risk${e.risk} ${e.approval}${e.error ? c.red(" ERR") : ""}`);
  }
});

// ---------- tunnel ----------
const tunnel = program.command("tunnel").description("Tunnel control");
tunnel.command("status").action(() => {
  const gw = createGateway();
  const rt = fs.existsSync(gw.paths.runtimeFile) ? JSON.parse(fs.readFileSync(gw.paths.runtimeFile, "utf8")) : null;
  console.log(rt?.tunnel ? JSON.stringify(rt.tunnel, null, 2) : warn("No tunnel info (gateway not started)."));
});
tunnel.command("start").action(() => console.log(warn("The tunnel is started automatically by `start`/`setup`. Restart the gateway to (re)start it.")));
tunnel.command("stop").action(() => console.log(warn("Stop the tunnel by stopping the gateway (`localant stop`).")));

// ---------- approvals ----------
const approvals = program.command("approvals").description("Manage approval requests");
approvals.command("list").action(() => {
  const gw = createGateway();
  const pending = gw.approvals.listPending();
  if (!pending.length) return console.log("No pending approvals.");
  for (const a of pending) console.log(`${c.bold(a.id)} ${a.tool} ${c.yellow("risk" + a.risk)} ${a.requirement} — ${a.summary}`);
});
approvals.command("approve <id>").option("--session", "approve for the whole session").action((id, o) => {
  const gw = createGateway();
  const r = gw.approvals.approve(id, o.session ? "session" : "once");
  console.log(r ? ok(`Approval ${id}: ${r.status} (${r.approvalsGiven}/${r.requirement === "double" ? 2 : 1})`) : fail("Not found"));
});
approvals.command("deny <id>").action((id) => {
  const gw = createGateway();
  const r = gw.approvals.deny(id);
  console.log(r ? ok(`Approval ${id}: denied`) : fail("Not found"));
});

// ---------- skills ----------
const skills = program.command("skills").description("Manage skills");
skills.command("list").action(() => {
  const gw = createGateway();
  for (const s of gw.skills.list()) {
    const state = s.enabled ? c.green("enabled") : c.gray("disabled");
    console.log(`${c.bold(s.manifest.name)} v${s.manifest.version} ${state} risk${s.manifest.riskLevel}${s.generated ? c.gray(" [generated]") : ""}${s.valid ? "" : c.red(" [invalid]")}`);
  }
});
skills.command("info <name>").action((name) => {
  const gw = createGateway();
  const s = gw.skills.get(name);
  console.log(s ? JSON.stringify({ ...s, validation: gw.skills.validate(name) }, null, 2) : fail("Not found"));
});
skills.command("enable <name>").action((name) => {
  const gw = createGateway();
  try {
    gw.skills.setEnabled(name, true);
    console.log(ok(`Enabled ${name}`));
  } catch (e) {
    console.log(fail((e as Error).message));
  }
});
skills.command("disable <name>").action((name) => {
  const gw = createGateway();
  gw.skills.setEnabled(name, false);
  console.log(ok(`Disabled ${name}`));
});
skills.command("validate <name>").action((name) => {
  const gw = createGateway();
  console.log(JSON.stringify(gw.skills.validate(name), null, 2));
});
skills.command("install <gitUrl>").action(async (url) => {
  const gw = createGateway();
  const res = await gw.executeTool("skill_install_from_git", { url }, { caller: "cli" });
  console.log(JSON.stringify(res, null, 2));
});
skills.command("publish <name>").action(async (name) => {
  const gw = createGateway();
  const res = await gw.executeTool("skill_publish_to_git", { name }, { caller: "cli" });
  console.log(JSON.stringify(res, null, 2));
});

// ---------- projects ----------
const projects = program.command("projects").description("Manage projects");
projects.command("list").action(() => {
  const gw = createGateway();
  for (const p of gw.projects.list()) console.log(`${c.bold(p.name)} ${c.gray(p.path)} [${(p.stack ?? []).join(", ")}]`);
});
projects.command("add <path>").option("--name <name>").action((path, o) => {
  const gw = createGateway();
  try {
    const p = gw.projects.register(path, o.name);
    console.log(ok(`Registered ${p.name} (${p.id})`));
  } catch (e) {
    console.log(fail((e as Error).message));
  }
});
projects.command("remove <id>").action((id) => {
  const gw = createGateway();
  console.log(gw.projects.unregister(id) ? ok("Removed") : fail("Not found"));
});

// ---------- secrets ----------
const secrets = program.command("secrets").description("Manage secrets (values never displayed)");
secrets.command("set <name>").argument("[value]", "secret value (or read from CLA_SECRET env)").action((name, value) => {
  const gw = createGateway();
  const v = value ?? process.env.CLA_SECRET;
  if (!v) return console.log(fail("Provide a value or set CLA_SECRET env var."));
  gw.vault.set(name, v);
  console.log(ok(`Stored secret '${name}'`));
});
secrets.command("list").action(() => {
  const gw = createGateway();
  const names = gw.vault.list();
  console.log(names.length ? names.join("\n") : "No secrets stored.");
});
secrets.command("remove <name>").action((name) => {
  const gw = createGateway();
  console.log(gw.vault.remove(name) ? ok(`Removed '${name}'`) : fail("Not found"));
});

function ensureWorkspace(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

program.parseAsync(process.argv).catch((err) => {
  console.error(fail(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
