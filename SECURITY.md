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
| Public tunnel exposure | Medium | Mandatory auth token; rate-limited `/mcp`; dashboard warnings; tunnel is opt-out |
| Malicious web page driving the local dashboard (CSRF / DNS-rebinding) | Medium | Dashboard `/api/*` requires a per-process token embedded only in the served HTML; non-local `Host` headers rejected |
| Token leakage via `?key=` in tunnel logs | Medium | Bearer header recommended; `localant token rotate` re-issues without losing secrets |
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

LocalAnt exposes two shell paths:

- **`shell_run_allowed_command`** (allowlist) — allowlist prefix matching;
  pipeline/redirection/chaining/substitution rejected; commands split to argv and
  executed directly (no shell interpreter), with a timeout and output cap.
- **`bash`** (arbitrary, risk 3) — runs through a real shell (`bash -c`) so
  pipelines and `&&` work, but **only after**:
  - **CommandGuard** rejects blocked tokens (`sudo`, `su`, `dd`, `mkfs`,
    `fdisk`, `diskutil`, `shutdown`, `reboot`, …) across *every* pipeline
    segment, and rejects `rm -rf` / `chmod 777`;
  - **PathGuard** validates the `cwd`;
  - the security **mode policy** gates it (see below).

In **all** modes `CORE_BLOCKED_COMMAND_TOKENS` and `rm -rf` are rejected — even
in `yolo`, and even after approval. Background processes (`shell_run_background`)
go through the same guard.

### Mode behaviour for `bash` (risk 3)

| Mode | `bash` behaviour |
|------|------------------|
| `strict` | requires approval; only allowlisted commands run without it |
| `open` | runs without approval but **always audited**; only risk-4 needs approval |
| `yolo` | runs without approval; blocklist + core tokens still rejected; audited |

## Secret safety

- Secrets stored in an AES-256-GCM encrypted vault keyed from a **dedicated,
  random vault key** held in `vault.key` (mode `0600`) — independent of the auth
  token, so rotating the token never makes stored secrets undecryptable. Secrets
  written by older versions (token-derived key) are transparently migrated.
- Listing returns **names only**; values are never displayed. `secret_set` stores
  a value but **no tool ever returns it**; `secret_remove` is risk 4.
- Tool output and audit entries are deep-redacted for known secret values and
  token-shaped strings — including `bash` and coding-agent output.
- Skills receive only the secret values they declare in their manifest, passed
  to an isolated subprocess — never the vault itself.

## Dashboard safety

The dashboard binds to `127.0.0.1` only, but localhost binding alone does not
stop a malicious web page from issuing requests to it. Two additional controls
close that gap:

- **Per-process token**: every `/api/*` call must carry an `x-dashboard-token`
  header. The token is embedded only in the dashboard HTML, which a cross-origin
  page cannot read, and the custom header cannot be forged cross-origin without
  a CORS preflight that is never granted — defeating CSRF.
- **Host allowlisting**: requests whose `Host` header is not local
  (`localhost`, `127.0.0.1`, `::1`) are rejected, defeating DNS-rebinding.

## Browser safety

- Browser automation uses an **isolated profile by default** — never your
  day-to-day logged-in Chrome profile. Using a login-capable profile is an
  explicit opt-in (`browser_use_profile`) and exposes your sessions to
  automation; treat it as a strong-approval action.
- `browser_evaluate` (arbitrary in-page JS) is risk 4.

## Network safety

- The public `/mcp` endpoint is rate-limited per client IP.
- Rotate the auth token at any time with `localant token rotate`; stored secrets
  are preserved. Prefer `Authorization: Bearer <token>` over `?key=<token>` where
  your client supports custom headers, since query strings can appear in proxy
  and tunnel access logs.

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
