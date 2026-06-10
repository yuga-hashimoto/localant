# Security

`LocalAnt` performs operations on your local machine on behalf of a
remote model (ChatGPT). Security is the top design priority. This document
describes the threat model and the controls that mitigate it.

## Threat model

| Actor / vector | Risk | Mitigation |
|----------------|------|------------|
| ChatGPT requests a destructive action | High | Risk levels + local approval queue; ChatGPT confirmation never trusted alone |
| Prompt-injected ChatGPT tries to read secrets/credentials | High | Secret vault (encrypted), redaction, sensitive-path blocklist |
| Path traversal / symlink escape | High | `PathGuard` resolves realpaths and re-checks allowlist + blocklist |
| Shell injection / command chaining | High | `CommandGuard` rejects pipes/redirection/substitution; allowlist prefix match; hard blocklist |
| Public tunnel exposure | Medium | Mandatory auth token; dashboard warnings; tunnel is opt-out |
| Malicious third-party skill | Medium | Skills disabled by default; per-skill permission manifest; isolated subprocess execution; only declared secrets injected |
| Secret leakage to logs/responses | Medium | Deep redaction of known secret values + token-shaped strings |

## Default deny

Nothing is permitted unless explicitly allowed:

- **Filesystem**: only paths inside `security.allowedDirectories`. Sensitive
  paths (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gcloud`, Keychains, `/etc`,
  `/var`, `/System`, `C:\Windows`, …) are always denied — even via symlink.
- **Shell**: no raw shell. `shell_run_allowed_command` only accepts commands
  matching the allowlist; pipes, redirection, chaining, and command
  substitution are rejected. A hard blocklist (`sudo`, `rm -rf`, `dd`, `mkfs`,
  `chmod 777`, `ssh`, `shutdown`, …) applies even to approved commands.
- **Network/secrets/browser/adb/git/agent**: per-skill permission modes; tools
  default to the least-privilege option.

## Risk levels & approval

| Risk | Meaning | Approval |
|------|---------|----------|
| 0 | read-only | none |
| 1 | safe write draft | configurable (`approveRisk1`, default off) |
| 2 | file modification | single approval |
| 3 | shell / agent / network write | single approval |
| 4 | destructive / publish / deploy | **double approval** |

Approvals are managed **locally** (dashboard, CLI `approvals`, or the
`approval_*` MCP tools). A risk-2+ tool call returns `approvalRequired` until a
human approves it; once-approvals are consumed after a single use.

## Filesystem safety

- Allowed-directory allowlist + sensitive-path blocklist.
- Path traversal (`..`) and symlink traversal prevention (realpath re-check).
- Backup-before-write for modifications/deletes; `fs_list_backups` /
  `fs_restore_backup`.
- Max file size and binary-file guard on reads; draft writes refuse overwrite.

## Shell safety

- Allowlist prefix matching; pipeline/redirection/chaining/substitution rejected.
- Hard blocklist enforced even after approval.
- No shell interpreter — validated commands are split to argv and executed
  directly with a timeout and output cap.

## Secret safety

- Secrets stored in an AES-256-GCM encrypted vault keyed from the local token.
- Listing returns **names only**; values are never displayed.
- Tool output and audit entries are deep-redacted for known secret values and
  token-shaped strings.
- Skills receive only the secret values they declare in their manifest, passed
  to an isolated subprocess — never the vault itself.

## Skill safety

- Generated and git-installed skills are saved **disabled**.
- Each skill ships a permission manifest and risk level, surfaced before enable.
- Skills execute in an isolated Node subprocess.
- `skill_validate` checks manifest + required files before enabling.

## Audit

Every tool call is appended to `audit/audit.jsonl` with timestamp, tool, caller,
risk, redacted input/output summaries, approval result, duration, and error.

## Reporting vulnerabilities

Please open a private security advisory on the repository or email the
maintainers rather than filing a public issue. Include reproduction steps and
affected versions. We aim to acknowledge within a few days.
