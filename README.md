<p align="center">
  <img src="assets/hero.png" width="320" alt="LocalAnt — ChatGPT-native Local MCP Gateway" />
</p>

# LocalAnt

<p align="center">
  <a href="https://github.com/yuga-hashimoto/localant/actions/workflows/ci.yml"><img src="https://github.com/yuga-hashimoto/localant/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/localant"><img src="https://img.shields.io/npm/v/localant.svg" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/localant.svg" alt="node version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.ja.md">日本語</a>
</p>

> **Use ChatGPT as the brain. Use your local computer as the hands.**

`LocalAnt` lets you use ChatGPT as the brain and your local computer as the hands.

It exposes safe, permissioned local skills to ChatGPT through MCP:
run approved commands, inspect projects, manage files, call coding agents like
Claude Code or Codex, control browser/ADB, publish articles, and create your own
local skills — all behind a default-deny security model with local approval and
full audit logging.

```text
ChatGPT
  ↓ Apps SDK / MCP Connector (Streamable HTTP /mcp)
LocalAnt  ── Gateway · Risk engine · Approval queue · Audit log · Dashboard
  ↓ Local PC
  ├─ Shell · Filesystem · Git (deny-list by default · allow-list in strict mode)
  ├─ Claude Code / Codex (plan → approve → execute → validate → diff)
  ├─ Browser (Playwright, isolated profile) · Android (ADB)
  ├─ Articles (Zenn / Qiita / note, via skill) · Custom Skills
  └─ Adapters: OpenClaw · Desktop Commander · any MCP server
```

---

## What is LocalAnt?

A **local-first MCP Gateway** for ChatGPT. ChatGPT is the conversational UI and
decision-maker; your PC is the execution environment. The gateway publishes a
catalog of **200+ permissioned tools** over the Model Context Protocol, which
ChatGPT's Developer-Mode connectors can call.

The design is inspired by OpenClaw (local gateway + skills + registry),
Desktop Commander (local PC control + audit + hardening), supergateway
(stdio→Streamable-HTTP `/mcp`), and mcp-proxy (bundling MCP servers) — but the
brain is **ChatGPT**, and every capability is wrapped in permissions, approval,
and audit.

## Why ChatGPT as brain, local PC as hands?

- ChatGPT is great at reasoning, planning, and conversation.
- Your PC is where your code, files, devices, and tools actually live.
- Handing ChatGPT a raw shell is dangerous. Instead, this gateway gives it a
  **curated, permissioned surface** with local approval for anything risky.

## Features

- 🔒 **Layered security**: deny-list by default (sensitive-path blocklist +
  always-blocked commands), optional `strict` allow-list mode, path & symlink
  traversal prevention, secret vault + redaction.
- ✅ **Local approval queue**: risk-2+ tools require explicit approval in the
  dashboard or CLI — ChatGPT's confirmation is never trusted alone.
- 🧾 **Full audit log**: every tool call recorded (with secrets redacted).
- 🧩 **Skill system**: create, validate, enable, run, install-from-git,
  publish, and **generate skills from ChatGPT** (always saved disabled).
- 🤖 **Coding agents**: drive Claude Code / Codex (plan → approve → execute →
  validate → diff) on any working directory.
- 🖥️ **Local dashboard**: status, approvals, audit, skills, secrets, agents.
- 🌐 **3-minute setup** with Tailscale Funnel by default, plus Cloudflare Tunnel / ngrok fallbacks and clipboard copy.
- 🔌 **Adapters** for OpenClaw, Desktop Commander, and arbitrary MCP servers.

## ChatGPT as a local coding agent

LocalAnt is also a **ChatGPT-native local coding-agent runtime**. ChatGPT can
read, search, edit, run, test, and diff a project on your machine through MCP —
behind the same approval / audit / security pipeline as everything else.

It exposes the standard **Codex / Claude Code / OpenCode**-style tool names:

| Category | Tools |
|----------|-------|
| Read / search | `read` · `read_file_range` · `grep` · `glob` · `list_files` · `get_file_info` |
| Edit | `write` · `edit` · `multi_edit` · `apply_patch` · `move_file` · `copy_file` · `create_directory` · `delete_file` |
| Run | `bash` · `shell_run_background` · `shell_get_output` · `shell_stop` · `command_exists` |
| Git | `git_status` · `git_diff` · `git_add` · `git_commit` · `git_restore` · `git_stash` · `git_reset` · `git_apply_patch` · `git_is_dirty` |
| Validate | `project_run_tests` · `project_run_lint` · `project_run_typecheck` · `project_run_build` · `project_run_validation` · `project_get_package_scripts` |
| Code intel | `lsp_status` · `lsp_diagnostics` · `lsp_document_symbols` · `lsp_go_to_definition` · `lsp_find_references` · `lsp_hover` · `lsp_rename_symbol` |
| Approve | `approval_request` (the human approves in the dashboard / CLI) |
| Delegate | `agent_run` (claude-code · codex · opencode · openclaw · antigravity-cli · hermes-agent) |

> **No web search / web fetch / todo / "ask the user" tools** — ChatGPT already
> does web search, browsing, planning, and asking you directly, so tool-ifying
> those would only bloat the surface. LocalAnt exposes only what it *uniquely*
> provides: your local files, shell, git, toolchain, language server, browser,
> device, and agents.

`bash` runs through a real shell (pipelines and `&&` work) **but** every command
is screened by CommandGuard (blocked tokens, `rm -rf`, …), the `cwd` is validated
by PathGuard, and the call is gated by the security mode (approval in `strict`,
audited-but-ungated in `open`, ungated in `yolo` — with `CORE_BLOCKED_COMMAND_TOKENS`
rejected even in `yolo`).

**Tool profiles** keep the advertised surface sharp:

- `minimal` — the small delegation core (shell / agent / skill + read-only fs).
- `coding` — the full coding surface above (recommended for ChatGPT-as-coder).
- `full` — every tool (browser, adb, skill authoring, destructive git, secrets).

```bash
localant tools profile coding   # switch profile
localant tools list             # see what's exposed
```

Then just ask ChatGPT:

> "Look at this repo, fix the bug, run `pnpm validate`, and show me the `git diff`."

ChatGPT will check project/git state, `grep`/`glob` for the code, `edit`/`apply_patch`
the fix, `bash` the validation, iterate on errors, and return `git_diff`.

## 3-minute setup

```bash
npx -y localant setup
```

or:

```bash
npm install -g localant
localant setup
```

`setup` checks your environment, initializes config, generates an auth token,
enables built-in skills, starts the gateway + dashboard, opens a public tunnel,
copies the MCP URL to your clipboard, and prints the ChatGPT connection steps.

```text
✅ LocalAnt is running

  Local Gateway:  http://127.0.0.1:8787
  Dashboard:      http://127.0.0.1:8788
  MCP Endpoint:   https://your-machine.your-tailnet.ts.net/mcp?key=********

Connect ChatGPT:
  1. Open ChatGPT → Settings → Apps & Connectors
  2. Advanced settings → Developer Mode ON
  3. Connectors → Create
  4. Paste the MCP URL above
  5. Set Authentication to "None"
  6. Name it: LocalAnt
```

> **From source** (this repo): `pnpm install && pnpm build && node packages/cli/dist/bin.js setup`

## ChatGPT setup

1. ChatGPT → **Settings → Apps & Connectors**
2. **Advanced settings → Developer Mode ON**
3. **Connectors → Create**
4. Paste the **MCP URL** (`https://…/mcp?key=<token>`)
5. Set **Authentication** to **None**
6. Name it **LocalAnt**
7. Ask ChatGPT: *"Run health check on my local app"*

The token is embedded in the URL so the connector authenticates even where
custom headers aren't available. You can also send `Authorization: Bearer <token>`.
See [docs/chatgpt-setup.md](docs/chatgpt-setup.md).

> **Tip — Tailscale Funnel is the default tunnel.** Configure your stable
> Funnel FQDN (`machine.tailnet.ts.net`) in the dashboard **Settings** tab or
> with `localant config set tunnel.domain <domain>`. The auth token is
> persistent, so a stable URL means you connect ChatGPT **once**. Cloudflared,
> ngrok, localtunnel and serveo remain available as fallback providers.
> Full instructions: [docs/chatgpt-setup.md → Keep a fixed URL](docs/chatgpt-setup.md#keep-a-fixed-url-dont-recreate-the-connector-every-time).

## Security model

LocalAnt has three security modes (set `security.mode` in config or the
dashboard Settings tab):

| Mode | Filesystem / shell | Approval gates | For |
|------|--------------------|----------------|-----|
| **`open`** (default) | deny-list — everything allowed except the sensitive blocklist + core blocked tokens | only risk-4 (destructive/publish) | personal single-user machines |
| `strict` | allow-list — only allowed directories & commands | per risk level (see below) | shared / multi-user environments |
| `yolo` | deny-list (same as `open`) | none at all | trusted automation only |

The default is **`open`**: a deny-list model for personal use. There is no
directory or command allow-list to maintain — ChatGPT can read/write anywhere
and run any command **except** the always-blocked items below.

**Strict-mode approval matrix:**

| Risk | Meaning | Approval (strict) | Approval (open) |
|------|---------|-------------------|-----------------|
| 0 | read-only | none | none |
| 1 | safe write draft | config (default none) | none |
| 2 | file modification | **required** | none |
| 3 | shell / agent / network write | **required** | none |
| 4 | destructive / publish / deploy | **double approval** | **double approval** |

**Always enforced, in every mode (including `open` and `yolo`):**

- Sensitive paths (`~/.ssh`, `~/.aws`, `~/.gnupg`, `/etc`, Keychains, …) are
  **never** readable or writable; symlink escapes are caught.
- Core blocked commands — `sudo`, `su`, `dd`, `mkfs`, `fdisk`, `diskutil`,
  `shutdown`, `reboot` — and `rm -rf` / `chmod 777` are **always rejected** and
  cannot be removed from the blocklist.
- Secrets live in an encrypted local vault and are **redacted** from tool
  output and the audit log.
- Generated/installed skills are **disabled by default** until you review them.

Full details: [SECURITY.md](SECURITY.md).

## Dashboard

A local-only dashboard (`http://127.0.0.1:8788`) is a full control panel — every
setting that's available on the CLI is editable from the web, and vice versa.
A live status badge and a pending-approvals counter update automatically.

Tabs: **Home · Tools · Security · Approvals · Audit · Secrets · Agents ·
Settings**.

- **Home** — status, MCP endpoint (copy), tunnel start/stop/restart, **Test
  connection** (fetches the public URL to confirm ChatGPT can reach you), health
  check.
- **Tools** — browse every exposed tool, with **Skills** (create, enable/disable,
  inspect permissions, uninstall) and **MCP** (add/test/remove downstream stdio
  servers) sub-tabs.
- **Security** — read-only view of the active mode, allowed directories/commands
  (strict mode only), always-blocked command tokens, and the risk policy.
- **Approvals** — live pending-approval queue (approve/deny, per-session option).
- **Audit** — full-text search and click-through to the full input/output of any
  entry.
- **Secrets** — add/remove with reveal toggle (names only).
- **Agents** — enable/disable (e.g. Codex), **launch plan/execute tasks** against
  a working directory and live-tail their logs.
- **Settings** — security mode (open/strict/yolo), risk policy, **tool profile**,
  **auth token reveal/rotate** (rotation takes effect with no restart), tunnel
  provider + fixed-URL config with **Save & restart**, gateway/dashboard ports,
  allowed directories/commands, blocked tokens (core tokens shown but locked),
  and a raw JSON editor with validation.

## Skills

Skills are the unit of extension. Layout:

```text
skills/<name>/
  skill.json     # manifest: permissions + risk + tool schemas
  README.md  LICENSE  CHANGELOG.md
  src/index.ts   # defineSkill({...})
  tests/index.test.ts
  examples/
```

Manage them with `skill_list/info/enable/disable/run/validate/...` tools or the
CLI (`localant skills ...`). See [docs/skills.md](docs/skills.md).

### How to create a skill

```ts
import { defineSkill, z } from "@localant/skill-sdk";

export default defineSkill({
  name: "hello-world",
  tools: {
    hello: {
      description: "Say hello",
      riskLevel: 0,
      inputSchema: z.object({ name: z.string() }),
      handler: async ({ name }) => ({ content: `Hello ${name}` }),
    },
  },
});
```

### How to generate a skill from ChatGPT

> "Create a skill named `qiita-private-post` that posts private Qiita articles
> using a QIITA_TOKEN secret."

ChatGPT calls `skill_generate_from_prompt`. The gateway scaffolds the manifest,
README, source and tests, **infers permissions**, sets it **disabled**, and runs
validation. You review permissions in the dashboard, then `skill_enable` (which
requires approval). See [docs/skills.md](docs/skills.md).

## How to connect Claude Code

Enable an agent in config (`codingAgents.claude-code.enabled = true`), then point
it at a working directory:

```text
coding_agent_plan(agent:"claude-code", cwd:"/Users/me/Documents/my-app", task:"Plan SEO improvements")
# review the plan, approve, then:
coding_agent_start_task(agent:"claude-code", cwd:"/Users/me/Documents/my-app", task:"Implement the plan")
# creates a work branch, runs the agent, then:
coding_agent_get_diff(taskId) · coding_agent_run_validation(cwd, command:"pnpm validate")
```

Execution is risk-3 (approval required), runs on a fresh branch, warns on a dirty
tree, and is followed by diff + validation. See [docs/coding-agents.md](docs/coding-agents.md).

## Codex example

Same flow with `agent:"codex"` once `codingAgents.codex.enabled = true` and the
`codex` CLI is on PATH.

## Article publishing

Article publishing is provided by the bundled **`article-publisher` skill**
(disabled by default — enable it with `skill_enable` / `localant skills enable
article-publisher` first):

- **Zenn**: GitHub-repo method — writes `articles/<slug>.md` with
  `published:false`, can open a PR branch. (`zenn_*`)
- **Qiita**: official API with `QIITA_TOKEN` from the vault; private-first.
  (`qiita_*`)
- **note**: local drafts only (note has no official public write API).
  (`note_*`)

Publish actions are **risk 4 (double approval)**. See [docs/articles.md](docs/articles.md).

## Browser automation

Playwright-based (optional peer dependency), using an **isolated profile** by
default. `browser_open/screenshot/extract_text/click/type/...` — all risk 3.
See [docs/browser.md](docs/browser.md).

## Android ADB

`adb_list_devices/screenshot/tap/swipe/input_text/logcat/install_apk/...`.
Input/installs are risk 3 and audited. See [docs/adb.md](docs/adb.md).

## OpenClaw adapter

`openclaw_status/list_skills/run_skill/list_sessions/...` — bridges to a local
`openclaw` CLI if installed, otherwise returns clear install guidance. Every call
flows through the gateway's permission + approval + audit pipeline.

## Desktop Commander adapter

`desktop_commander_status/list_tools/run_tool` — gated bridge; tools are never
exposed unmediated.

## Existing MCP bridge

Register downstream MCP servers (`mcp_server_register/list/status/...`) to bundle
them behind the gateway's safety pipeline.

## CLI

```bash
localant setup | start | stop | restart | status | doctor | uninstall
localant update [--check] [--pm npm|pnpm|yarn|bun]   # update to the latest published version and restart
localant token rotate | show   # re-issue the auth token (secrets preserved)
localant tunnel status | start | stop
localant config show | set <key> <value>   # e.g. localant config set security.mode open
localant dashboard | logs
localant approvals list | approve <id> [--session] | deny <id>
localant skills list | info <name> | enable <name> | disable <name> | install <git-url> | validate <name> | publish <name>
localant secrets set <name> [value] | list | remove <name>
localant tools list | profile <minimal|coding|full>
localant agents list | detect | run <agent> <cwd> <task> [--execute] | logs <taskId> | stop <taskId>
localant mcp list | test <name> | import-all
```

## Architecture

A pnpm + TypeScript monorepo with project references:

| Package | Responsibility |
|---------|----------------|
| `shared` | config schema, paths, risk model, redaction, types, logger |
| `gateway` | stores, security guards, managers, tool registry, execution pipeline |
| `mcp` | Streamable HTTP `/mcp`, auth, dashboard API |
| `dashboard` | self-contained local dashboard |
| `cli` | `setup`/`start`/`doctor`/… commands |
| `skill-sdk` | `defineSkill` for external skill authors |

See [docs/architecture.md](docs/architecture.md).

## FAQ

- **Does ChatGPT get a raw shell?** Depends on the mode. In `strict` mode only
  allow-listed commands run without approval; anything else needs explicit local
  approval. In the default `open` mode (and `yolo`) `bash` runs arbitrary
  commands — but the always-blocked tokens (`sudo`, `rm -rf`, `dd`, …) are
  rejected in every mode and PathGuard still blocks sensitive paths.
- **Where is my config?** `~/.localant` on every platform (override with the
  `LOCALANT_HOME` env var). A pre-1.x install under `~/Library/Application
  Support/LocalAnt` / `~/.config/LocalAnt` is migrated automatically on first run.
- **Do I need Claude Code/Codex/adb/Playwright?** Only for those specific tool
  families; they degrade gracefully with install guidance.
- **Is the tunnel safe?** A public tunnel exposes the gateway; the auth token is
  required, the dashboard warns you, and you should stop the tunnel when idle.

## Troubleshooting

`localant doctor` diagnoses your environment. More in
[docs/troubleshooting.md](docs/troubleshooting.md).

## How to uninstall

```bash
localant uninstall          # prints steps
localant uninstall --purge  # also deletes the config/data directory
npm uninstall -g localant
```

## Contributing

Contributions are welcome — especially tests and security hardening. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, coding standards, and the release
process, and [ROADMAP.md](ROADMAP.md) for where the project is headed. Please
report vulnerabilities privately per [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
