# Security (overview)

The full threat model and controls live in [../SECURITY.md](../SECURITY.md).
Highlights:

## Modes

- **`open`** (default) — deny-list model for personal single-user machines.
  No directory/command allow-list; everything is permitted except the sensitive
  blocklist and core blocked tokens. Only risk-4 (destructive/publish) actions
  need approval.
- **`strict`** — allow-list model for shared/multi-user environments. Only
  allowed directories and commands; risk 2+ requires approval.
- **`yolo`** — deny-list with no approval gates at all. Trusted automation only.

Switch modes in the dashboard **Settings** tab or with
`localant config set security.mode <mode>`.

## Always enforced (every mode)

- **Sensitive-path blocklist** (`~/.ssh`, `~/.aws`, `~/.gnupg`, `/etc`, `/var`,
  Keychains, `C:\Windows`, …) — never readable/writable, even in `open`/`yolo`.
- **Core blocked commands** — `sudo`, `su`, `dd`, `mkfs`, `fdisk`, `diskutil`,
  `shutdown`, `reboot`, plus `rm -rf` / `chmod 777` — always rejected and cannot
  be removed from the blocklist.

## Tool profile (advertised surface)

`tools.profile` controls how many tools are advertised to ChatGPT:

- **`minimal` (default)** — only a small core surface: the three delegation
  pillars (**Shell** `shell_*`, **coding Agent** `coding_agent_*`, **Skill**
  `skill_run`/`skill_list`/…), a read-only filesystem path (`fs_read_file`,
  `fs_list_files`, `fs_search_content`, …), the MCP
  bridge (`mcp_server_*` — connect downstream MCP servers and proxy their tools),
  and the control plane (status, approvals, audit). Real work is pushed onto shell
  commands, coding agents, and skills rather than bespoke tools. Tools outside
  this set are also blocked at execution time, so a hallucinated call can't reach
  them.
- **`full`** — every registered tool (browser, adb, git, CLI adapters,
  filesystem writes, skill authoring, …). Note: article publishing moved to the
  `article-publisher` skill; the MCP bridge (`mcp_server_*`) is in `minimal`.

Switch profiles in the dashboard or by setting `tools.profile` in the config.
The smaller `minimal` surface keeps ChatGPT's tool selection sharp and shrinks
each request.

## Other controls

- **Risk levels 0–4**; in `strict`, risk 2+ requires local approval, risk 4
  requires double approval. In `open`, only risk 4 requires approval.
- **Local approval** via dashboard, CLI (`approvals`), or `approval_*` tools —
  ChatGPT's confirmation is never trusted alone.
- **Path/symlink guards** and a sensitive-path blocklist (`~/.ssh`, `~/.aws`,
  `/etc`, `/var`, `C:\Windows`, …).
- **Command guard**: no raw shell; no pipes/redirection/chaining/substitution;
  hard blocklist even after approval.
- **Secret vault** (encrypted) + deep redaction in outputs and audit log.
- **Skills disabled by default**; per-skill permission manifests; isolated
  subprocess execution.
- **Audit log** of every call.

## Operational guidance

- Stop the tunnel when you're not using it (`localant stop`).
- Keep the MCP URL/token private; rotate by deleting `token` in the config dir
  and restarting (you'll re-add the connector).
- Review skills before enabling; check the permission manifest and risk level.
- In `strict` mode, keep `allowedDirectories` tight — add project dirs, not your
  whole home. In `open` mode the allow-list is ignored; rely on the blocklist.
- On a shared machine, switch to `strict`.
