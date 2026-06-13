#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { createGateway } from "@localant/gateway";
import { APP_VERSION, ConfigSchema, isToolInProfile } from "@localant/shared";
import { c, ok, warn, fail, openBrowser, promptYesNo } from "./util.js";
import { runGateway, type StartOptions } from "./runtime.js";
import { runDoctor } from "./doctor.js";
import { ensureServeoRegistration } from "./serveo-setup.js";
import { ensureTailscaleSetup } from "./tailscale-setup.js";
import { autostartSupported, isAutostartEnabled, enableAutostart, disableAutostart, bounceAutostart } from "./autostart.js";
import { OPTIONAL_DEPS, checkOptionalDeps, printOptionalDeps, tryInstallOptionalDep } from "./optional-deps.js";

/** True when `candidate` is a strictly higher semver than `current`. */
function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

const program = new Command();
program.name("LocalAnt").description("Use ChatGPT as the brain and your local computer as the hands.").version(APP_VERSION);

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

    // Serveo gives a stable, free URL only once the user's SSH key is registered.
    // Handle that one-time registration here so first-run setup "just works" —
    // and skip silently for users (like returning ones) who are already set up.
    const cfg = gw.config();
    if (o.tunnel !== false && cfg.tunnel.provider === "serveo" && !cfg.tunnel.token && cfg.tunnel.subdomain) {
      console.log("");
      await ensureServeoRegistration(cfg.tunnel.subdomain, cfg.gateway.port, { noOpen: o.open === false });
    }

    // Tailscale Funnel is the default. Walk first-time users through the one-time
    // install → login → enable-Funnel steps so the tunnel comes up on its own.
    // Skipped when a fixed FQDN / publicUrl is already configured.
    if (o.tunnel !== false && cfg.tunnel.provider === "tailscale" && !cfg.tunnel.publicUrl && !cfg.tunnel.domain) {
      const tailscaleDomain = await ensureTailscaleSetup(cfg.gateway.port, { noOpen: o.open === false });
      if (tailscaleDomain) {
        gw.saveConfig({
          ...gw.config(),
          tunnel: {
            ...gw.config().tunnel,
            domain: tailscaleDomain,
          },
        });
        console.log(ok(`Tailscale domain registered: ${c.cyan(tailscaleDomain)}`));
      }
    }

    // Offer to start LocalAnt automatically on every login (macOS launchd).
    if (autostartSupported() && !isAutostartEnabled()) {
      console.log("");
      const enable = await promptYesNo(
        "Start LocalAnt automatically when you log in? (no need to run setup again)",
        true,
      );
      if (enable) {
        const p = enableAutostart(gw.paths.logsDir);
        console.log(ok(`Auto-start enabled — takes effect on your next login. (${p})`));
        console.log(c.gray("   Disable anytime with: localant autostart disable"));
      } else {
        console.log(c.gray("Skipped auto-start. Enable later with: localant autostart enable"));
      }
    }

    // Offer to install optional capability dependencies (browser automation,
    // desktop control). These pull in heavy / platform-specific binaries, so
    // they are opt-in and default to "no".
    const optional = await checkOptionalDeps();
    for (const dep of optional) {
      if (!dep.supported || dep.installed) continue;
      console.log("");
      const install = await promptYesNo(
        `Enable ${dep.capability}? Installs: ${dep.manualHint}`,
        false,
      );
      if (install) {
        if (tryInstallOptionalDep(dep)) console.log(ok(`${dep.capability} enabled.`));
      } else {
        console.log(c.gray(`Skipped. Enable later with: localant deps install ${dep.id}`));
      }
    }

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
  .option("--json", "output status as JSON")
  .action((o) => {
    const gw = createGateway();
    const started = fs.existsSync(gw.paths.runtimeFile);
    const rt = started ? JSON.parse(fs.readFileSync(gw.paths.runtimeFile, "utf8")) : null;
    let running = false;
    if (fs.existsSync(gw.paths.pidFile)) {
      const pid = Number(fs.readFileSync(gw.paths.pidFile, "utf8").trim());
      try {
        process.kill(pid, 0);
        running = true;
      } catch {
        running = false;
      }
    }

    if (o.json) {
      console.log(
        JSON.stringify(
          {
            started,
            running,
            version: APP_VERSION,
            gateway: rt?.gateway ?? null,
            dashboard: rt?.dashboard ?? null,
            mcpEndpoint: rt?.mcpEndpoint ?? null,
            tunnel: rt?.tunnel ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!started) return console.log(warn("Gateway has not been started yet."));
    console.log(running ? ok("Gateway is running") : warn("Gateway is not running (stale runtime info shown)"));
    console.log(`  Gateway:   ${c.cyan(rt.gateway)}`);
    console.log(`  Dashboard: ${c.cyan(rt.dashboard ?? "(disabled)")}`);
    console.log(`  MCP URL:   ${c.cyan(rt.mcpEndpoint ?? "(tunnel off)")}`);
  });

program
  .command("doctor")
  .description("Check the environment")
  .option("--json", "output the report as JSON")
  .action(async (o) => {
    const passed = await runDoctor({ json: Boolean(o.json) });
    process.exit(passed ? 0 : 1);
  });

// ---------- optional capability dependencies ----------
const deps = program.command("deps").description("Manage optional capability dependencies (browser, desktop control)");
deps
  .command("list")
  .description("Show optional capabilities and whether they are installed")
  .action(async () => {
    printOptionalDeps(await checkOptionalDeps());
  });
deps
  .command("install [id]")
  .description("Install an optional capability dependency (browser|desktop), or all missing ones")
  .action(async (id?: string) => {
    const statuses = await checkOptionalDeps();
    const targets = id ? statuses.filter((d) => d.id === id) : statuses.filter((d) => d.supported && !d.installed);
    if (id && targets.length === 0) {
      return console.log(fail(`Unknown dependency '${id}'. Use one of: ${OPTIONAL_DEPS.map((d) => d.id).join(", ")}.`));
    }
    if (targets.length === 0) return console.log(ok("All supported optional capabilities are already installed."));
    for (const dep of targets) {
      if (!dep.supported) {
        console.log(warn(`${dep.capability} is not supported on this platform.`));
        continue;
      }
      if (dep.installed) {
        console.log(ok(`${dep.capability} already installed.`));
        continue;
      }
      console.log(c.gray(`Installing ${dep.capability} … (${dep.manualHint})`));
      if (tryInstallOptionalDep(dep)) console.log(ok(`${dep.capability} enabled.`));
    }
  });

program
  .command("update")
  .description("Update LocalAnt to the latest published version and restart the running gateway")
  .option("--check", "only check for a newer version; do not install")
  .option("--pm <manager>", "package manager to use (npm|pnpm|yarn|bun)", "npm")
  .action((o) => {
    const current = APP_VERSION;
    let latest: string;
    try {
      latest = execFileSync("npm", ["view", "localant", "version"], { encoding: "utf8" }).trim();
    } catch {
      return console.log(fail("Could not reach npm to check for updates. Are you online?"));
    }
    if (!isNewerVersion(latest, current)) {
      return console.log(ok(`Already up to date (v${current}).`));
    }
    console.log(`Update available: ${c.gray("v" + current)} → ${c.cyan("v" + latest)}`);
    if (o.check) {
      return console.log(c.gray("Run `localant update` to install it."));
    }

    // Install the latest globally with the chosen package manager.
    const pm = String(o.pm);
    const installArgs: Record<string, string[]> = {
      npm: ["install", "-g", "localant@latest"],
      pnpm: ["add", "-g", "localant@latest"],
      yarn: ["global", "add", "localant@latest"],
      bun: ["add", "-g", "localant@latest"],
    };
    const args = installArgs[pm];
    if (!args) return console.log(fail(`Unknown package manager '${pm}'. Use npm|pnpm|yarn|bun.`));
    console.log(c.gray(`Installing localant@latest via ${pm} …`));
    try {
      execFileSync(pm, args, { stdio: "inherit" });
    } catch {
      return console.log(fail(`${pm} install failed. Try manually: ${pm} ${args.join(" ")}`));
    }
    console.log(ok(`Updated to v${latest}.`));

    // Auto-switch: restart the running gateway so it serves the new version.
    let restarted = false;
    if (autostartSupported() && isAutostartEnabled()) {
      // Re-point the LaunchAgent at the freshly installed binary (its path may
      // have changed) by regenerating the plist via the NEW global `localant`,
      // then bounce the launchd job.
      try {
        execFileSync("localant", ["autostart", "enable"], { stdio: "ignore" });
      } catch {
        /* keep the existing plist */
      }
      restarted = bounceAutostart();
    }
    if (restarted) {
      console.log(ok("Restarted the running gateway — now serving the new version."));
    } else {
      console.log(c.gray("Restart the gateway to apply: localant restart"));
    }
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

// ---------- token ----------
const tokenCmd = program.command("token").description("Manage the gateway auth token");
tokenCmd
  .command("rotate")
  .description("Generate a new auth token (stored secrets are preserved)")
  .action(() => {
    const gw = createGateway();
    const next = gw.configStore.rotateToken();
    console.log(ok("Auth token rotated. Stored secrets are unaffected."));
    console.log(`  New token: ${c.cyan(next)}`);
    console.log(warn("Restart the gateway and re-create the ChatGPT connector with the new MCP URL."));
  });
tokenCmd
  .command("show")
  .description("Print the current auth token")
  .action(() => {
    const gw = createGateway();
    console.log(gw.configStore.getToken());
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

// ---------- autostart ----------
const autostart = program.command("autostart").description("Start LocalAnt automatically on login (macOS)");
autostart
  .command("enable")
  .description("Install the login LaunchAgent")
  .action(() => {
    if (!autostartSupported()) return console.log(warn("Auto-start on login is only supported on macOS."));
    const gw = createGateway();
    const p = enableAutostart(gw.paths.logsDir);
    console.log(ok(`Auto-start enabled — takes effect on your next login. (${p})`));
  });
autostart
  .command("disable")
  .description("Remove the login LaunchAgent and stop the managed instance")
  .action(() => {
    if (!autostartSupported()) return console.log(warn("Auto-start on login is only supported on macOS."));
    disableAutostart();
    console.log(ok("Auto-start disabled."));
  });
autostart
  .command("status")
  .description("Show whether auto-start on login is enabled")
  .action(() => {
    if (!autostartSupported()) return console.log(warn("Auto-start on login is only supported on macOS."));
    console.log(isAutostartEnabled() ? ok("Auto-start is enabled.") : warn("Auto-start is not enabled."));
  });

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
skills
  .command("new <name>")
  .description("Scaffold a new local skill skeleton (created disabled)")
  .option("-d, --description <text>", "what the skill does", "A local skill.")
  .option("--risk <n>", "risk level 0-3", "1")
  .action((name, o) => {
    const gw = createGateway();
    const risk = Number(o.risk);
    if (!Number.isInteger(risk) || risk < 0 || risk > 3) {
      return console.log(fail("--risk must be an integer 0-3."));
    }
    try {
      const state = gw.skills.generate({ name, description: o.description, riskLevel: risk as 0 | 1 | 2 | 3 });
      console.log(ok(`Created skill '${name}' (disabled).`));
      console.log(`  ${c.gray(state.dir)}`);
      console.log(c.gray("  Edit src/index.ts, then:"));
      console.log(`    localant skills validate ${name}`);
      console.log(`    localant skills enable ${name}`);
    } catch (e) {
      console.log(fail((e as Error).message));
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
skills
  .command("search [query]")
  .description("Search configured skill registries for skills to install")
  .option("--json", "output results as JSON")
  .action(async (query: string | undefined, o) => {
    const gw = createGateway();
    const res = await gw.executeTool("skill_search_registry", { query: query ?? "" }, { caller: "cli" });
    const data = res.data as { results: { name: string; description?: string; source: string }[]; sources: string[] };
    if (o.json) return console.log(JSON.stringify(res.data, null, 2));
    if (!data.sources.length) {
      console.log(warn("No skill registries configured. Add sources under config.skillRegistry.sources."));
      return;
    }
    if (!data.results.length) return console.log("No matching skills found.");
    for (const s of data.results) {
      console.log(`${c.bold(s.name)} ${c.gray(s.description ?? "")}`);
      console.log(`  ${c.cyan(s.source)} — install: localant skills install <git-url>`);
    }
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

// ---------- config ----------
const configCmd = program.command("config").description("Manage configuration");
configCmd
  .command("show")
  .description("Print the current configuration")
  .action(() => {
    const gw = createGateway();
    console.log(JSON.stringify(gw.config(), null, 2));
  });
configCmd
  .command("set <key> <value>")
  .description("Set a configuration value (e.g. security.mode yolo)")
  .action((key, value) => {
    const gw = createGateway();
    const cfg = gw.config();

    let parsedVal: any = value;
    if (value === "true") parsedVal = true;
    else if (value === "false") parsedVal = false;
    else if (!isNaN(Number(value))) parsedVal = Number(value);

    // handle nested key paths, e.g. security.mode
    const parts = key.split(".");
    let curr = cfg as any;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = parsedVal;

    try {
      const parsed = ConfigSchema.parse(cfg);
      gw.saveConfig(parsed);
      console.log(ok(`Set config ${key} = ${value}`));
    } catch (e) {
      console.log(fail(`Invalid configuration: ${(e as Error).message}`));
    }
  });

// ---------- tools ----------
const toolsCmd = program.command("tools").description("Inspect and switch the exposed tool profile");
toolsCmd
  .command("list")
  .description("List tools exposed under the active profile")
  .action(() => {
    const gw = createGateway();
    const profile = gw.config().tools.profile;
    const tools = gw.registry.list().filter((t) => isToolInProfile(t.name, profile));
    console.log(c.bold(`Profile: ${profile} (${tools.length} tools)`));
    for (const t of tools) console.log(`  ${t.name} ${c.gray(`[risk ${t.risk}]`)}`);
  });
toolsCmd
  .command("profile [name]")
  .description("Show or set the tool profile (minimal|coding|full)")
  .action((name?: string) => {
    const gw = createGateway();
    if (!name) {
      console.log(`Current tool profile: ${c.bold(gw.config().tools.profile)}`);
      return;
    }
    if (!["minimal", "coding", "full"].includes(name)) {
      return console.log(fail("Profile must be one of: minimal, coding, full"));
    }
    gw.saveConfig({ ...gw.config(), tools: { profile: name as "minimal" | "coding" | "full" } });
    console.log(ok(`Tool profile set to '${name}'. Restart the gateway for it to take effect.`));
  });

// ---------- agents ----------
const agentsCmd = program.command("agents").description("Manage local coding agents");
agentsCmd.command("list").action(async () => {
  const gw = createGateway();
  for (const a of await gw.agents.list()) {
    console.log(`${c.bold(a.agent)} ${a.available ? ok("available") : c.gray("not installed")}`);
  }
});
agentsCmd
  .command("detect")
  .description("Detect which configured agents have their CLI installed")
  .action(async () => {
    const gw = createGateway();
    for (const a of await gw.agents.list()) console.log(`${a.agent}: ${a.available ? "yes" : "no"}`);
  });
agentsCmd
  .command("run <agent> <cwd> <task>")
  .option("--execute", "execute (default: plan only)")
  .action(async (agent, cwd, task, o) => {
    const gw = createGateway();
    try {
      const res = o.execute
        ? await gw.agents.startTask(agent, cwd, task, { createBranch: true })
        : await gw.agents.plan(agent, cwd, task);
      console.log(JSON.stringify(res, null, 2));
    } catch (e) {
      console.log(fail((e as Error).message));
    }
  });
agentsCmd.command("logs <taskId>").action((taskId) => {
  const gw = createGateway();
  console.log(gw.agents.getLogs(taskId));
});
agentsCmd.command("stop <taskId>").action(async (taskId) => {
  const gw = createGateway();
  console.log(JSON.stringify(await gw.agents.stopTask(taskId)));
});

// ---------- mcp ----------
const mcpCmd = program.command("mcp").description("Manage downstream MCP servers");
mcpCmd.command("list").action(() => {
  const gw = createGateway();
  const servers = gw.config().mcpServers;
  const names = Object.keys(servers);
  if (!names.length) return console.log("No MCP servers registered.");
  for (const name of names) {
    const s = servers[name]!;
    console.log(`${c.bold(name)} ${c.gray(`[${s.transport}]`)} ${s.enabled ? ok("enabled") : c.gray("disabled")}`);
  }
});
mcpCmd.command("test <name>").action(async (name) => {
  const gw = createGateway();
  try {
    const tools = await gw.bridge.listTools(name);
    console.log(ok(`${name}: ${tools.length} tools`));
    for (const t of tools) console.log(`  ${t.name}`);
  } catch (e) {
    console.log(fail((e as Error).message));
  }
});
mcpCmd
  .command("import-all")
  .description("Import MCP servers from Claude Code / Codex / OpenCode configs (disabled by default)")
  .action(async () => {
    const gw = createGateway();
    const res = await gw.executeTool("mcp_import_all_agent_configs", {}, { caller: "cli" });
    console.log(JSON.stringify(res.data ?? res.error, null, 2));
  });

function ensureWorkspace(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

program.parseAsync(process.argv).catch((err) => {
  console.error(fail(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
