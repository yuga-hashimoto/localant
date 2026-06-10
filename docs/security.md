# Security (overview)

The full threat model and controls live in [../SECURITY.md](../SECURITY.md).
Highlights:

- **Default deny** for filesystem, shell, network, secrets, browser, adb, git, agent.
- **Risk levels 0–4**; risk 2+ requires local approval, risk 4 requires double approval.
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
- Keep `allowedDirectories` tight — add project dirs, not your whole home.
