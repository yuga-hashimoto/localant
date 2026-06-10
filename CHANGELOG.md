# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

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
