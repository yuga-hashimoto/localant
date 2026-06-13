# Roadmap

This is a living document of where LocalAnt is headed. Priorities may shift —
open an issue or discussion to propose changes. Items are not commitments.

## Recently shipped

- [x] Per-tool-family risk documentation ([docs/tools.md](docs/tools.md))
- [x] Correct per-agent coding-agent invocations + turn-based session resume

## Now (hardening the core)

- [x] Dashboard CSRF / DNS-rebinding protection (per-process token + Host check)
- [x] Vault key separated from auth token; `localant token rotate`
- [x] Rate-limited `/mcp`
- [x] Expanded security test coverage (vault, approvals, redaction, HTTP auth)
- [x] Tag-driven npm release with provenance; CI on Linux/macOS/Windows × Node 20/22
- [x] Coverage reporting wired to source (vitest resolves workspace packages to `src`)
- [x] Audit log rotation honoring `logRetentionDays`

## Next (usability & reach)

- [x] One-command setup recording / demo GIF in the README
- [x] `localant skills new <name>` scaffolder for the skill SDK
- [x] Skill registry: browse/search/install from curated sources (`localant skills search`)
- [x] Per-session approval UX improvements in the dashboard (bulk approve/deny, mobile-friendly tap targets)
- [ ] Listing on the MCP registry and awesome-mcp-servers (drafts in [docs/distribution.md](docs/distribution.md))
- [x] Japanese README (`README.ja.md`); `docs/` parity still pending

## Later (ecosystem)

- [ ] Optional richer dashboard (React/Vite) as a separate workspace
- [ ] More coding agents beyond Claude Code / Codex
- [ ] Signed skills and a trust policy for third-party skills
- [ ] Windows-first parity pass (paths, ADB, browser profiles) — _in progress_:
      config/data paths use `os.homedir()`; shell selection uses `cmd /c`;
      external CLIs (agents, cloudflared, ngrok) now resolve `.cmd`/`.exe`
      shims via PATHEXT (`resolveExecutable`). Still needs verification on a real
      Windows host + ADB/browser-profile audit.

## Ideas / discussion

Have a use case we're missing? Start a thread in
[Discussions](https://github.com/yuga-hashimoto/localant/discussions) or open a
feature request.
