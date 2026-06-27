# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.13] - 2026-06-27

### Added
- LocalAnt Video Studio now generates presentation-style short videos with
  Remotion as the primary renderer and VOICEVOX as the primary Japanese TTS.
- Video Studio outputs Remotion render props, motion plan, MP4, thumbnail, SRT,
  ASS, and word timing files, and reviews rendered videos for narration cutoff.
- ChatGPT-generated images can be imported into Video Studio scenes through the
  Asset bridge, including chunked base64 upload for large images.
- Dashboard settings now expose optional ChatGPT tool toggles for Video Studio
  and the generated-image Asset bridge.

### Changed
- Video Studio and Asset bridge tools are hidden from ChatGPT by default and are
  advertised over MCP only after the matching Dashboard feature is enabled.

## [1.4.9] - 2026-06-16

### Fixed
- Dashboard no longer gets stuck on "connecting…": a raw newline was emitted
  into the inline client `<script>` (the failed-attempt log builder used `'\n'`
  inside the outer HTML template literal, which evaluated to a literal newline
  and broke the single-quoted string with `SyntaxError: Invalid or unexpected
  token`, halting the whole script before it could poll `/api/status`). The
  escape is now `'\\n'` so the served script parses. Regression from 1.4.8.

## [1.4.8] - 2026-06-15

### Changed
- Autopilot now falls back to the next provider on silent auth/config failures:
  coding-agent CLIs that print an auth error but still exit `0` are detected and
  surfaced as an `auth_error` instead of being treated as success. Failed-attempt
  logs are shown in the dashboard, and the redundant **Agents** tab was dropped.

### Fixed
- Anchored the Autopilot prompt to value-consuming flags for the `agy` and
  `hermes` providers, whose prompt flags consume the following token, so the
  prompt is no longer mis-parsed.
- `openclaw` agent invocation now requires `--session-id`.

## [1.4.7] - 2026-06-15

### Added
- **Command Code** as a built-in coding agent / Autopilot provider
  (id `command-code`, command `cmd`). Command Code ([commandcode.ai](https://commandcode.ai/))
  ships Claude Code-compatible flags, so it runs non-interactively via
  `cmd -p <prompt>` (plan/execute) and resumes the last session with
  `cmd -p -c <prompt>`. It is selectable as primary or a fallback in the
  dashboard's **Autopilot** tab.
- Deprecated compatibility wrappers for retired tool names (per-agent
  `coding_agent_*` / `agent_*`, `localant_autopilot_*`, `openclaw_*`,
  `desktop_commander_*`) so stale ChatGPT tool schemas keep working instead of
  failing with "Unknown tool". New flows should still prefer the high-level
  `autopilot` tool and the generic MCP bridge.

### Changed
- Hardened Autopilot per-directory locking with a TTL, stale-lock pruning, and
  an `activeRuns()` diagnostic so a hung run can no longer block a directory
  indefinitely.
- Bounded the downstream MCP `connect` / `listTools` / `callTool` operations
  with timeouts so an unresponsive server surfaces a clear timeout error instead
  of hanging.

### Fixed
- Generated skills are now runnable out of the box.

## [1.4.6] - 2026-06-14

### Added
- **Autopilot page** (dashboard): a dedicated **Autopilot** tab that answers
  "which agent runs when ChatGPT calls `autopilot`?". It shows the resolved
  provider chain with live availability (ready / disabled / CLI not on PATH),
  and lets you pick the primary provider, enable/disable providers, reorder the
  fallback chain, and configure the fallback policy — all in one place.
- **Autopilot test** (read-only): run the real provider chain against a
  directory in a non-mutating mode (`plan` / `review`) to confirm the
  configured agent answers — no edits, no branch. Surfaces each attempt in
  order (ok / skipped / failed + reason) plus the output.
- New dashboard API: `GET /api/autopilot` (config + resolved order + per-provider
  availability) and `POST /api/autopilot/test` (mutating modes are coerced to
  `plan`).

### Changed
- The Autopilot controls moved out of **Settings** into the new **Autopilot**
  tab; Settings now links to it.

## [1.4.5] - 2026-06-14

### Added
- **Autopilot**: a single high-level `autopilot` tool replaces the per-agent
  delegation surface. ChatGPT delegates in natural language (`task` / `cwd` /
  `mode` = plan · execute · review · fix · pr / `constraints` / `timeoutMs`)
  and never names a backend. The automation provider is chosen by the user.
- **Autopilot Settings** (dashboard): pick the primary provider, enable/disable
  providers, reorder the fallback chain, and configure the fallback policy.
  Persisted in `config.autopilot`.
- **Fallback policy**: on primary failure, Autopilot advances through the
  fallback chain — timeout / non-zero exit / empty output / no changes / rate
  limit / command-not-found fall back by default; **safety block** and
  **approval required** do not. The next provider receives the prior failure
  reason, an output summary, and the existing diff, and continues from the
  current working-tree state on the same branch.
- **`localant_doctor`**: read-only structured diagnostics (connection/version,
  exposed tool count, allowed dirs, tunnel/Tailscale, OS permissions, screenshot
  capability, Git/GitHub CLI, Node/pnpm/Python, browser automation, ADB,
  automation-provider availability, and recent errors/blocks/timeouts).

### Changed
- The agent CLIs (Claude Code / Codex / opencode / OpenClaw / Antigravity /
  Hermes) are no longer public tools — they live on as **internal Autopilot
  providers**. Provider names appear only in the Web UI and `localant_doctor`,
  never on the ChatGPT-facing `autopilot` surface.

### Removed
- The per-agent public tools (`coding_agent_*`, `agent_run` and the `agent_*`
  aliases, the previous `localant_autopilot_*` set) and the coding-agent widget.
  The low-level bash/git/file/browser/adb/screenshot tools are unchanged.

## [1.4.4] - 2026-06-13

### Added
- Turn-based ChatGPT ⇄ coding-agent dialogue: `coding_agent_continue_task` now
  resumes the agent's prior session (via per-agent `resumeArgs`, e.g. `claude -c`,
  `codex exec resume --last`, `hermes --continue`) on the same work branch.
- `localant skills new <name>` scaffolds a new local skill skeleton (disabled).
- `localant skills search [query]` searches configured skill registries.
- `--json` output for `localant status` and `localant doctor`.
- Example "local hands" skills: **file-organizer** (sort a folder by type/date)
  and **local-backup** (timestamped `.tar.gz` snapshots via a `tar`-only allowlist).
- Dashboard: **Approve all / Deny all** for pending approvals, plus full-width
  thumb-sized approval buttons on small screens.
- `docs/tools.md` documents every tool family with its risk level; root
  `server.json` manifest for the official MCP registry.
- Demo recording embedded in the README (GIF linking the full MP4).

### Fixed
- Coding-agent adapter now uses each CLI's correct non-interactive invocation
  (`codex exec`, `opencode run`, `hermes chat -q`, `openclaw agent --local -m`,
  `agy --print`, `claude -p`). Adds a `{{prompt}}` placeholder for agents that
  take the prompt mid-argv. Fixes Hermes/OpenClaw (prompt was read as a
  subcommand) and Codex (interactive mode without a TTY).
- Audit log now prunes entries older than `logRetentionDays` (on startup and
  throttled thereafter).
- Windows: external CLIs (coding agents, cloudflared, ngrok) resolve their
  `.cmd`/`.exe` shims via PATHEXT, fixing ENOENT when spawned with `shell:false`.

### Changed
- Upgraded zod 3 → 4.4.3.

## [1.4.3] - 2026-06-13

### Fixed
- `localant deps install browser` no longer fails with `EUNSUPPORTEDPROTOCOL`
  when run from a pnpm/yarn workspace. Heavy optional dependencies (Playwright)
  now install into an isolated `~/.localant/optional-deps` directory with its own
  `package.json`, so `npm install` never climbs into a parent workspace and trips
  over `workspace:*` protocol deps. Tool resolution (`localant doctor` and the
  browser tools) looks in that directory too.
- Browser and desktop-control tools now point at the first-class
  `localant deps install <browser|desktop>` command in their "not installed"
  errors instead of raw `npm`/`brew` invocations.

## [1.4.2] - 2026-06-12

### Added
- Optional capability dependencies are now first-class: `localant doctor` reports
  whether browser automation (Playwright + Chromium) and desktop mouse/keyboard
  control (`cliclick`) are installed, `localant setup` offers to install the
  missing ones, and a new `localant deps list|install [browser|desktop]` command
  manages them on demand.

### Changed
- Trimmed the `coding` tool profile to one name per function: 12 pure duplicate
  aliases (`read_file`, `read_file_range`, `write_file`, `edit_file`,
  `list_files`, `search_content`, `search_files`, `get_file_info`, `diff_file`,
  `shell_run`, `bash_output`, `kill_shell`) are no longer exposed. Each remains
  reachable through its canonical name (e.g. `read`, `grep`, `bash`,
  `fs_list_files`), so no capability is lost while tool-selection surface and
  request bloat shrink.
- `shell_run_background` now runs through a real shell (`bash -c` / `cmd /c`) so
  pipelines, redirection and `&&` chaining behave the same as the foreground
  `bash` tool instead of being passed as literal argv.
- `mcp_server_list_tools` returns an actionable hint when the target server is
  unregistered or disabled (how to register/enable it) instead of a bare
  connection error.
- Removed the redundant `desktop_commander_*` adapter tools; Desktop Commander is
  a regular downstream MCP server and is driven through the generic
  `mcp_server_*` bridge.
- Removed the eight `openclaw_*` CLI-wrapper tools. OpenClaw remains usable as a
  configured coding agent (via `agent_*` / `coding_agent_*`) or as a downstream
  MCP server, so no capability is lost while the tool surface stays focused.

### Fixed
- `fs_restore_backup` could never find a backup created via `fs_backup_file`: the
  backup lookup excluded exactly the metadata file it needed (an inverted
  `startsWith(id + "__")` guard), so every restore failed with "Backup not found".

## [1.4.1] - 2026-06-12

### Added
- High-level LocalAnt Autopilot tool surface for delegating local coding tasks through configured coding agents while keeping task status, logs, diffs, continuation, stop and validation as first-class tools.
- Per-tool MCP annotation overrides so high-level read-only Autopilot status/log/diff tools can advertise safe hints independently from mutating Autopilot actions.

### Changed
- yolo mode no longer advertises all tools as fake read-only; MCP annotations now reflect the tool actual risk while gateway approval behavior remains separate.
- Minimal tool profile now keeps MCP bridge execution and authoring out of the default surface and exposes only read/status MCP bridge tools.

### Fixed
- Coding-agent validation now goes through PathGuard and CommandGuard before execution.
- Coding-agent plan mode no longer receives gate-bypassing danger args, even in yolo mode.

## [1.4.0] - 2026-06-12

### Added
- **Interactive Apps SDK widgets for the core LocalAnt workflows.** Eight
  `text/html;profile=mcp-app` widgets now render tool results as UI instead of
  raw JSON, and their buttons drive `tools/call` back to the gateway via
  `window.openai.callTool` (Apps SDK pattern):
  - **Approval center** (`approval_list_pending` / `approval_get` /
    `approval_approve` / `approval_deny`) — pending requests as cards showing
    tool, risk, reason, summary and originating chat, with inline
    Approve once / Approve session / Deny.
  - **Coding-agent task panel** (`coding_agent_get_task` / `_start_task` /
    `_get_result` / `_continue_task`) — status, a polling logs tail, a colorized
    diff viewer, and Stop / Continue / Refresh.
  - **Git panel** (`git_status` / `git_list_changed_files` / `git_diff` /
    `git_commit` / `git_add`) — changed-file list with stage checkboxes, a
    per-file diff viewer, a commit-message box and Stage / Commit / Refresh, so
    long diffs never have to be read inline.
  - **Shell process panel** (`shell_list_processes` / `_get_process_output`) —
    tracked processes with an output tail and Stop.
  - **Browser panel** (`browser_open` / `_get_url` / `_console_logs` /
    `_extract_text`), **ADB panel** (`adb_list_devices` /
    `_get_current_activity` / `_dump_ui` / `_logcat`), **MCP server panel**
    (`mcp_server_list` / `_list_tools` / `_status`) and **skill panel**
    (`skill_list` / `_info` / `_validate` / `_enable` / `_disable`).

  Each widget advertises `_meta.ui.resourceUri` plus the compatibility
  `openai/outputTemplate`, keeps `structuredContent` model-visible, and shares a
  single client runtime (`packages/mcp/src/widgets/`).
- **Apps SDK image viewer for LocalAnt image results.** `fs_read_image`,
  image reads through `fs_read_file`, and `computer_screenshot` now advertise
  a `text/html;profile=mcp-app` image viewer resource via
  `_meta.ui.resourceUri` and the ChatGPT compatibility `openai/outputTemplate`.
  Image bytes are delivered in tool-result `_meta` for the widget while
  `structuredContent` stays lightweight and the existing MCP image content
  block remains available for compatible clients.
- **Per-chat session isolation.** Each ChatGPT chat opens its own MCP
  connection, so LocalAnt now mints a stateful `Mcp-Session-Id` per chat
  instead of tagging every call with the fixed id `"chatgpt"`. Sessions are
  tracked server-side, time out after 30 min idle, and are torn down on the
  client's `DELETE`. Stateless/legacy callers fall back to `chatgpt-default`.
- Audit entries now record the originating `sessionId`, so the dashboard audit
  log can tell chats apart.

### Changed
- **Browser state is now per session.** `browser_open` / `browser_*` keep a
  separate browser + page + console log per chat, so two chats no longer
  overwrite each other's tab. A session's browser is closed when the session
  ends or is swept for idleness.
- **Coding agents are session-aware and repo-locked.** Tasks carry their
  originating `sessionId`; `listTasks` can filter by it (dashboard still sees
  all). A repo lock refuses to start a second execution task against the same
  working tree, preventing branch/diff corruption when two chats target the
  same repo — this holds even in `yolo` mode where approval gates are off.
- **Once-approvals are bound to their session.** A pending once-approval can
  only be consumed by the chat that created it, so a different chat can't steal
  it. Legacy approvals without a session id remain consumable by anyone.

## [1.3.0] - 2026-06-12

### Fixed
- **ChatGPT no longer interrupts safe tool calls with a confirmation "safety
  check".** Tools are now advertised to MCP clients with proper annotations
  (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`)
  derived from each tool's risk level, so read-only tools like `git_status`
  run without a prompt while genuinely destructive tools stay flagged. The
  gateway's own approval pipeline is unchanged — these are client-side hints
  only.

### Changed
- **`yolo` mode now runs fully gate-free on the client too.** In `yolo`, every
  tool is advertised as read-only / non-destructive, so ChatGPT never stops any
  tool (read or write) behind a safety check — matching `yolo`'s "no approval
  gates at all" policy. `strict` and `open` keep risk-based hints.

## [1.2.1] - 2026-06-12

### Added
- **Computer Use (macOS desktop control).** New `computer_*` tool family:
  screenshot of the main display (returned inline to ChatGPT as an MCP image,
  resampled to logical resolution so image pixels map 1:1 to click
  coordinates), mouse move/click/double-click/right-click/drag, typing,
  clipboard paste, key combos with modifiers, and key-based scrolling.
  Screenshots use the built-in `screencapture`/`sips`; input uses `cliclick`
  (`brew install cliclick`). All input actions are risk 3 (audited; approval
  required in `strict` mode). Exposed only in the `full` tool profile. See
  `docs/computer-use.md`.
- **Image-aware MCP results.** `fs_read_image` and the image fallback in
  `fs_read_file` now actually render in ChatGPT: tool results may carry an
  inline image via an `__image` field (`{ mimeType, base64 }`), which the MCP
  server returns as a proper MCP image content block instead of inlining the
  base64 into the JSON text payload.

## [1.2.0] - 2026-06-12

### Added
- **Tailscale Funnel is the default tunnel.** Provides a stable, public HTTPS
  URL (`machine.tailnet.ts.net`) with no idle/response time cap — unlike serveo,
  which severs responses after ~10s and broke long-running tools (coding agents)
  over the tunnel. cloudflared, ngrok, localtunnel and serveo remain available
  as fallbacks; `localant config set tunnel.provider <name>` switches providers.
- **Guided Tailscale onboarding in `localant setup`.** First-time users are
  walked through install → login → enabling Funnel, with the relevant page
  opened automatically. Returning users hit only a fast readiness probe.

### Fixed
- **Coding agents no longer hang when spawned without a TTY.** Agents that
  default to an interactive TUI (e.g. `agy` / antigravity-cli) now run
  non-interactively (`--print`), and agents are spawned with stdin set to
  `/dev/null` so they see EOF immediately instead of blocking on input.
- **Per-agent `dangerArgs` replace a hardcoded, invalid `--danger` flag** for
  `yolo` mode (claude-code and antigravity-cli default to
  `--dangerously-skip-permissions`).
- **Robust Tailscale Funnel startup.** Resolves the macOS app-bundle CLI (the
  GUI build isn't on `PATH`); clears stale port-443 config before claiming the
  funnel; and falls back to another provider when the configured one can't
  publish a URL, instead of leaving the gateway with no tunnel.

## [1.1.1] - 2026-06-12

### Removed
- **Project registry.** The `ProjectRegistry`, all `project_register` /
  `project_list` / `project_get` / `project_status` / `project_unregister` /
  `project_set_*` / `project_detect_stack` tools, the `/projects` dashboard API,
  the dashboard **Projects** tab and the `localant projects` CLI command have
  been removed. Coding-agent tasks no longer require registering a project first
  — they operate directly on a working-directory path.

### Changed (breaking)
- **Coding-agent tools now take a path instead of a project id.** `agent_run`,
  `coding_agent_plan` and `coding_agent_start_task` accept `cwd` (absolute
  working-directory path) in place of `projectId`. `coding_agent_run_validation`
  now takes `cwd` + an explicit `command`. The `/agents/run` API uses `cwd`.
- **Validation / LSP tools take `path`.** `project_run_tests` / `lint` /
  `typecheck` / `format` / `build` / `validation`, `project_get_package_scripts`,
  `project_install_deps` and `lsp_diagnostics` accept `path` (a directory) in
  place of `projectId`. `git_*` `repo` arguments are plain paths.
- **`fs_list_allowed_directories` is mode-aware.** In `open`/`yolo` mode it
  reports that filesystem access is not restricted to the listed directories
  (only the sensitive blocklist applies), so connected agents no longer
  self-restrict to the advertised allowlist.

## [1.1.0] - 2026-06-11

### Added
- **ChatGPT-native local coding-agent runtime.** Codex / Claude Code / OpenCode
  style tools so ChatGPT can read, search, edit, run, test and diff a local
  project over MCP — all behind the existing approval/audit/redaction pipeline,
  PathGuard and CommandGuard. Existing tool names are preserved.
  - Editing: `read`/`write`/`edit`/`multi_edit`/`apply_patch`/`grep`/`glob` plus
    `move_file`/`copy_file`/`create_directory`/`delete_file` and aliases.
  - Shell: `bash` (real shell via `bash -c`, screened by CommandGuard + PathGuard,
    risk 3) and tracked background processes (`shell_run_background`/
    `shell_get_output`/`shell_stop`), `command_exists`.
  - Git: `git_add`/`git_reset`/`git_reset_hard`/`git_stash`/`git_clean_preview`/
    `git_apply_patch`/`git_get_current_branch`/`git_is_dirty` + checkout aliases.
  - Project validation: `project_run_tests`/`lint`/`typecheck`/`format`/`build`/
    `validation` and `project_get_package_scripts` (package-manager auto-detect).
  - Code intelligence: real TypeScript LanguageService LSP (`lsp_document_symbols`/
    `go_to_definition`/`find_references`/`hover`/`rename`) + `lsp_diagnostics`.
  - Agent delegation: `agent_run` + `agent_*` aliases over `coding_agent_*`.
  - Control: `secret_set`/`secret_get_names`/`secret_remove`, `tunnel_start`/
    `stop`/`restart`, `permission_get`/`set`, `risk_policy_get`/`set`,
    `approval_request`.
- **`coding` tool profile** (minimal ⊂ coding ⊂ full) and CLI `localant tools
  list` / `localant tools profile <name>`, plus `localant agents` / `localant mcp`
  commands and new dashboard API routes.
- **Streamable HTTP MCP** downstream transport and `mcp_import_*` (import MCP
  servers from Claude Code / Codex / OpenCode configs; imported servers start
  disabled).

### Changed
- **Config/data directory moved to `~/.localant`** on every platform (override
  with `LOCALANT_HOME`). A pre-1.x install under `~/Library/Application
  Support/LocalAnt` / `~/.config/LocalAnt` is migrated automatically on first run
  (token, vault key, secrets, config, serveo registration, audit preserved).

### Removed
- Tools that merely duplicate ChatGPT's native abilities — `websearch`,
  `webfetch`, `todowrite`/`todo_*`/`plan_*`/`task_*`, `question`/`ask_user`.
  LocalAnt exposes only what it *uniquely* provides (local files, shell, git,
  toolchain, LSP, browser, device, agents). `approval_approve`/`approval_deny`
  are kept out of the `coding` profile so ChatGPT cannot self-approve.

### Security
- **Dashboard CSRF / DNS-rebinding protection**: `/api/*` now requires a
  per-process token embedded only in the served HTML, and rejects non-local
  `Host` headers. Closes a hole where a malicious web page could drive the
  local dashboard (including approving pending risk-3 actions).
- **Vault key separated from the auth token**: secrets are encrypted with a
  dedicated random key (`vault.key`), so rotating the auth token no longer makes
  stored secrets undecryptable. Legacy token-derived secrets are migrated
  transparently on startup.
- **Rate limiting** added to the public `/mcp` endpoint.

### Added
- `localant token rotate` / `localant token show` — re-issue the auth token
  without losing stored secrets.
- `test:coverage` script and v8 coverage provider.
- Centralized `APP_VERSION` (replaces hardcoded `1.0.0` strings).
- Community health files: CONTRIBUTING, CODE_OF_CONDUCT, issue/PR templates,
  Dependabot, ROADMAP, Japanese README, and README badges.

### Changed
- Runtime minimum Node lowered to **20.10** (from 22) for end users running the
  prebuilt package. CI builds/tests on Node 22 across Linux/macOS/Windows
  (pnpm 11 itself requires Node 22.13+).
- Releases are **tag-driven** with npm **provenance**; pushing to `main` no
  longer publishes (this was the cause of red CI on merges).
- Expanded test suite: secret vault (encryption/migration), approval store
  (single/double/session/consume), redaction, and HTTP auth (401/dashboard
  token/Host check) — 33 → 65 tests.

## [1.0.0] - 2026-06-10

### Added
- Local-first MCP Gateway exposing 140+ permissioned tools over Streamable HTTP `/mcp`.
- CLI: `setup`, `start`, `stop`, `restart`, `status`, `doctor`, `update`,
  `uninstall`, `tunnel`, `dashboard`, `logs`, `approvals`, `skills`, `projects`, `secrets`.
- Security: default-deny path/command guards, sensitive-path blocklist, symlink
  traversal prevention, encrypted secret vault, deep secret redaction, risk
  engine (0–4) and local approval queue (single/double).
- Tool families: system, audit, approval, project, filesystem, git, shell,
  coding-agent, skill, browser, ADB, article (Zenn/Qiita/note), and adapters
  (OpenClaw, Desktop Commander, MCP bridge).
- Skill system with `defineSkill` SDK, isolated subprocess execution,
  validation, git install/publish, and ChatGPT-driven generation
  (`skill_generate_from_prompt`, always disabled).
- Coding-agent integration (Claude Code / Codex): plan → approve → execute →
  validate → diff.
- Self-contained local dashboard (status, approvals, audit, skills, projects,
  secrets, agents).
- Tunnel helper (Cloudflare Tunnel → ngrok → user-provided URL).
- Audit log of every tool call with redaction.
- Tests (security, unit, integration), GitHub Actions CI, npm-publish config.
