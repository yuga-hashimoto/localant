# Autopilot (local automation)

LocalAnt drives local automation backends (Claude Code, Codex, Antigravity,
Hermes, OpenCode, OpenClaw) on your machine. ChatGPT acts as PM/reviewer; the
backend implements locally.

> **The per-agent tools were retired.** ChatGPT no longer sees
> `coding_agent_*` / `agent_run` / `localant_autopilot_*` in its tool list. It
> delegates through a **single high-level `autopilot` tool**, and the backend is
> chosen by **you** in the dashboard's **Autopilot Settings** — never by
> ChatGPT, which never names a provider. The low-level operation tools
> (bash, git, file, browser, adb, screenshot, …) are unchanged.

## The `autopilot` tool

ChatGPT calls one tool with natural language:

| Field | Meaning |
|---|---|
| `task` | What you want done, in plain language. |
| `cwd` | Absolute path to the repo. Must be inside an allowed directory. |
| `mode` | `plan` (no changes) · `execute` (implement) · `review` (read-only assessment) · `fix` (diagnose + repair + validate) · `pr` (implement and prepare a PR). |
| `constraints` | Optional scope/style constraints. |
| `timeoutMs` | Optional per-attempt timeout. |

There is **no** `agent` / `provider` argument. `pr` mode prepares the branch and
a PR description but never pushes or opens the PR — push / PR / publish / deploy
stay behind explicit approval via the dedicated git tools.

## Autopilot Settings (dashboard)

Open the dashboard → **Settings → Autopilot Settings**:

- **Primary provider** — tried first.
- **Providers (enabled)** — toggle each backend on/off.
- **Fallback chain** — ordered list, reorderable, tried after the primary fails.
- **Fallback policy** — which failure reasons advance to the next provider.

Settings persist in the config (`autopilot` block) and are read on every
`autopilot` call.

## Providers and their invocations

Each backend is an internal **provider**. The CLIs have different
non-interactive entry points; LocalAnt ships defaults that call each correctly
(the prompt is the trailing positional unless an arg contains `{{prompt}}`):

| Provider id | Command | Execute | Resume (continue) |
|---|---|---|---|
| `claude-code` | `claude` | `claude -p <prompt>` | `claude -p -c <prompt>` |
| `antigravity-cli` | `agy` | `agy --print <prompt>` | `agy --print -c <prompt>` |
| `codex` | `codex` | `codex exec --skip-git-repo-check <prompt>` | `codex exec resume --last <prompt>` |
| `opencode` | `opencode` | `opencode run <prompt>` | `opencode run --continue <prompt>` |
| `hermes-agent` | `hermes` | `hermes chat -q <prompt>` | `hermes chat --continue -q <prompt>` |
| `openclaw` | `openclaw` | `openclaw agent --local -m <prompt>` | (same; one agent turn) |
| `command-code` | `cmd` | `cmd -p <prompt>` | `cmd -p -c <prompt>` |

> Provider auth (`claude /login`, `codex login`, …) is a per-backend
> prerequisite — LocalAnt invokes the CLI but does not log you in. Authenticate
> the CLI in the same shell environment LocalAnt runs under.

## Fallback policy

When the primary provider fails, Autopilot advances through the fallback chain.
Whether a given failure permits a fallback is configurable (defaults shown):

| Reason | Default |
|---|---|
| Timeout | fall back |
| Non-zero exit | fall back |
| Empty output | fall back |
| No changes produced | fall back |
| Rate / usage limit | fall back |
| Command not found | fall back |
| **Safety block** | **stop** (provider-agnostic — every backend hits the same wall) |
| **Approval required** | **stop** (the human grants approval) |

When a provider partially changed the working tree before failing, the next
provider is given the prior failure reason, an output summary, and the existing
diff, and is told to **continue from the current state** on the same branch.

## Configure (raw)

```json
{
  "autopilot": {
    "primary": "claude-code",
    "fallbacks": ["codex", "opencode"],
    "providers": { "openclaw": { "enabled": false } },
    "fallbackPolicy": { "onSafetyBlock": false, "onApprovalRequired": false }
  },
  "codingAgents": {
    "claude-code": { "enabled": true, "command": "claude", "planArgs": ["-p"], "executeArgs": ["-p"] },
    "codex": { "enabled": true, "command": "codex", "timeoutMs": 600000 }
  }
}
```

No project registration is required — point `cwd` at an absolute path. In
`strict` mode it must be inside an allowed directory; in `open`/`yolo` mode any
path outside the sensitive blocklist works.

## Safety

- No arbitrary command is passed — only the configured backend command + the
  task prompt. `cwd` is guarded by PathGuard; the sensitive blocklist always
  applies; the existing risk engine / deny-list / approval queue still run.
- `autopilot` is risk 3 (audited). Mutating modes run on a fresh work branch.
- Push / PR / release / publish / destructive operations require explicit
  approval through the dedicated tools — Autopilot never performs them.
- `localant_doctor` reports provider availability and recent
  errors/blocks/timeouts (provider names are shown there and in the Web UI; the
  ChatGPT-facing `autopilot` surface never names a provider).
