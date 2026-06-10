# Troubleshooting

## `localant doctor`

Diagnose your environment. Run this first when something isn't working:

```bash
localant doctor
```

## Common issues

### Gateway won't start — port already in use

The gateway **auto-falls-back** to the next free port if its preferred port
(default `8787`) is busy — e.g. when Cloudflare's `workerd` / `wrangler dev` is
running, which also defaults to `8787`. The startup log and `LocalAnt
status` always show the port it actually bound to, and the printed MCP URL uses
that port, so there is normally nothing to do.

If you want a fixed port, set `gateway.port` (and `dashboard.port`) in
`config.json`. To see what is holding a port:

```bash
# Find what's using the port
lsof -i :8787
# Stop any stale gateway process
localant stop
```

### Tunnel not working

1. Check `localant doctor` — is `cloudflared` or `ngrok` on PATH?
2. Verify the tunnel status: `localant tunnel status`
3. Install Cloudflare Tunnel: `brew install cloudflare/cloudflare/cloudflared`
   (macOS) or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
4. Alternative: install ngrok from https://ngrok.com/download
5. Fallback: set `tunnel.publicUrl` in config to your own HTTPS URL.

### ChatGPT can't connect

1. Verify the MCP endpoint is reachable:
   ```bash
   curl https://xxxxx.trycloudflare.com/healthz
   ```
2. Check the auth token: the URL must include `?key=<token>`.
3. The dashboard shows the full MCP URL with the key embedded — copy from there.
4. Make sure Developer Mode is ON in ChatGPT settings.

### "Unauthorized" on every request

- The auth token is regenerated on each setup. If you set up again, the old URL
  stops working. Re-copy the new MCP URL.

### Tool returns "approval required"

This is expected for risk-2+ tools. Approve from the dashboard or:
```bash
localant approvals list
localant approvals approve <id>
```
Then ask ChatGPT to retry.

### "Permission denied" on filesystem tools

- Only paths inside `security.allowedDirectories` are accessible.
- Sensitive paths (`~/.ssh`, `/etc`, etc) are always blocked.
- Run `localant doctor` to see your allowed directories.

### "Command blocked" on shell tools

- Only allowlisted commands run without approval.
- Check `security.allowedCommands` and `security.blockedCommandTokens` in config.
- Pipes, redirection, and command chaining (`&&`, `||`, `;`, `|`) are rejected.

### Claude Code / Codex "not found"

- Enable the agent in config first:
  ```json
  "codingAgents": { "claude-code": { "enabled": true, "command": "claude" } }
  ```
- Make sure the CLI is on PATH: `which claude` or `which codex`.
- `localant doctor` checks for optional tools.

### Changes lost or files missing

- File mutations always create a backup first. Check:
  ```bash
  ls ~/Library/Application\ Support/LocalAnt/backups/
  ```
  (macOS path; adjust for your OS)

### Config directory location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/LocalAnt` |
| Linux | `~/.config/LocalAnt` |
| Windows | `%APPDATA%/LocalAnt` |

### Reset everything

```bash
localant uninstall --purge
# then set up fresh:
npx -y localant setup
```

### Where are the logs?

```bash
localant logs
```

Gateway process logs go to `logs/` inside the config directory.
The audit log (all tool calls) is at `audit/audit.jsonl`.

### Still stuck?

File an issue on the GitHub repository with:
- `localant doctor` output
- What you were doing
- Error message
- Platform and Node version (`node -v`, `uname -a`)
