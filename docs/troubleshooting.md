# Troubleshooting

## `chatgpt-local-app doctor`

Diagnose your environment. Run this first when something isn't working:

```bash
chatgpt-local-app doctor
```

## Common issues

### Gateway won't start — port already in use

```bash
# Find what's using the port
lsof -i :8787
# Stop any stale process
chatgpt-local-app stop
```

### Tunnel not working

1. Check `chatgpt-local-app doctor` — is `cloudflared` or `ngrok` on PATH?
2. Verify the tunnel status: `chatgpt-local-app tunnel status`
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
chatgpt-local-app approvals list
chatgpt-local-app approvals approve <id>
```
Then ask ChatGPT to retry.

### "Permission denied" on filesystem tools

- Only paths inside `security.allowedDirectories` are accessible.
- Sensitive paths (`~/.ssh`, `/etc`, etc) are always blocked.
- Run `chatgpt-local-app doctor` to see your allowed directories.

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
- `chatgpt-local-app doctor` checks for optional tools.

### Changes lost or files missing

- File mutations always create a backup first. Check:
  ```bash
  ls ~/Library/Application\ Support/chatgpt-local-app/backups/
  ```
  (macOS path; adjust for your OS)

### Config directory location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/chatgpt-local-app` |
| Linux | `~/.config/chatgpt-local-app` |
| Windows | `%APPDATA%/chatgpt-local-app` |

### Reset everything

```bash
chatgpt-local-app uninstall --purge
# then set up fresh:
npx -y chatgpt-local-app setup
```

### Where are the logs?

```bash
chatgpt-local-app logs
```

Gateway process logs go to `logs/` inside the config directory.
The audit log (all tool calls) is at `audit/audit.jsonl`.

### Still stuck?

File an issue on the GitHub repository with:
- `chatgpt-local-app doctor` output
- What you were doing
- Error message
- Platform and Node version (`node -v`, `uname -a`)
