# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
