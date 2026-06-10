# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
