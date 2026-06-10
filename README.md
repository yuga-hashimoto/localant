# LocalAnt

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
  ├─ Shell (allowlisted) · Filesystem (allowlisted) · Git
  ├─ Claude Code / Codex (plan → approve → execute → validate → diff)
  ├─ Browser (Playwright, isolated profile) · Android (ADB)
  ├─ Articles (Zenn / Qiita / note) · Custom Skills
  └─ Adapters: OpenClaw · Desktop Commander · any MCP server
```

---

## What is LocalAnt?

A **local-first MCP Gateway** for ChatGPT. ChatGPT is the conversational UI and
decision-maker; your PC is the execution environment. The gateway publishes a
catalog of **140+ permissioned tools** over the Model Context Protocol, which
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

- 🔒 **Default-deny security**: allowlisted dirs/commands, blocklist, path &
  symlink traversal prevention, secret vault + redaction.
- ✅ **Local approval queue**: risk-2+ tools require explicit approval in the
  dashboard or CLI — ChatGPT's confirmation is never trusted alone.
- 🧾 **Full audit log**: every tool call recorded (with secrets redacted).
- 🧩 **Skill system**: create, validate, enable, run, install-from-git,
  publish, and **generate skills from ChatGPT** (always saved disabled).
- 🤖 **Coding agents**: drive Claude Code / Codex (plan → approve → execute →
  validate → diff) on registered projects.
- 🖥️ **Local dashboard**: status, approvals, audit, skills, projects, secrets, agents.
- 🌐 **3-minute setup** with Cloudflare Tunnel / ngrok and clipboard copy.
- 🔌 **Adapters** for OpenClaw, Desktop Commander, and arbitrary MCP servers.

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
  MCP Endpoint:   https://xxxxx.trycloudflare.com/mcp?key=********

Connect ChatGPT:
  1. Open ChatGPT → Settings → Apps & Connectors
  2. Advanced settings → Developer Mode ON
  3. Connectors → Create
  4. Paste the MCP URL above
  5. Name it: LocalAnt
```

> **From source** (this repo): `pnpm install && pnpm build && node packages/cli/dist/bin.js setup`

## ChatGPT setup

1. ChatGPT → **Settings → Apps & Connectors**
2. **Advanced settings → Developer Mode ON**
3. **Connectors → Create**
4. Paste the **MCP URL** (`https://…/mcp?key=<token>`)
5. Name it **LocalAnt**
6. Ask ChatGPT: *"Run health check on my local app"*

The token is embedded in the URL so the connector authenticates even where
custom headers aren't available. You can also send `Authorization: Bearer <token>`.
See [docs/chatgpt-setup.md](docs/chatgpt-setup.md).

## Security model

| Risk | Meaning | Approval |
|------|---------|----------|
| 0 | read-only | none |
| 1 | safe write draft | config (default none) |
| 2 | file modification | **required** |
| 3 | shell / agent / network write | **required** |
| 4 | destructive / publish / deploy | **double approval** |

- No raw shell by default — only `shell_run_allowed_command` against an allowlist.
- Filesystem access limited to **allowed directories**; sensitive paths
  (`~/.ssh`, `~/.aws`, `/etc`, …) are always blocked; symlink escapes are caught.
- Secrets live in an encrypted local vault and are **redacted** from tool
  output and the audit log.
- Generated/installed skills are **disabled by default** until you review them.

Full details: [SECURITY.md](SECURITY.md).

## Dashboard

A local-only dashboard (`http://127.0.0.1:8788`) shows status, the MCP endpoint
(with copy button), pending approvals, the audit log, skills (enable/disable),
projects, secret names, and coding agents.

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
import { defineSkill, z } from "@LocalAnt/skill-sdk";

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

Enable an agent in config (`codingAgents.claude-code.enabled = true`), register a
project, then:

```text
coding_agent_plan(agent:"claude-code", projectId:"my-app", task:"Plan SEO improvements")
# review the plan, approve, then:
coding_agent_start_task(agent:"claude-code", projectId:"my-app", task:"Implement the plan")
# creates a work branch, runs the agent, then:
coding_agent_get_diff(taskId) · coding_agent_run_validation(projectId)
```

Execution is risk-3 (approval required), runs on a fresh branch, warns on a dirty
tree, and is followed by diff + validation. See [docs/coding-agents.md](docs/coding-agents.md).

## Codex example

Same flow with `agent:"codex"` once `codingAgents.codex.enabled = true` and the
`codex` CLI is on PATH.

## Article publishing

- **Zenn**: GitHub-repo method — writes `articles/<slug>.md` with
  `published:false`, can open a PR branch. (`zenn_*`)
- **Qiita**: official API with `QIITA_TOKEN` from the vault; private-first.
  (`qiita_*`)
- **note**: draft-first local files; publishing requires the note-mcp adapter.
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
localant setup | start | stop | restart | status | doctor | update | uninstall
localant tunnel status
localant dashboard | logs
localant approvals list | approve <id> [--session] | deny <id>
localant skills list | info <name> | enable <name> | disable <name> | install <git-url> | validate <name> | publish <name>
localant projects list | add <path> [--name <n>] | remove <id>
localant secrets set <name> [value] | list | remove <name>
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

- **Does ChatGPT get a raw shell?** No. Only allowlisted commands run without
  approval; anything else needs an explicit local approval.
- **Where is my config?** `~/Library/Application Support/LocalAnt` (macOS),
  `~/.config/LocalAnt` (Linux), `%APPDATA%/LocalAnt` (Windows).
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

## License

MIT — see [LICENSE](LICENSE).
