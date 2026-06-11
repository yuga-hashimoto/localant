# Connecting ChatGPT

1. Open **ChatGPT → Settings → Apps & Connectors**.
2. Open **Advanced settings** and turn **Developer Mode ON**.
3. Go to **Connectors → Create**.
4. Paste the **Connector URL** shown by `setup`:
   ```
   https://xxxxx.trycloudflare.com/mcp?key=<token>
   ```
5. Set **Authentication** to **None**.
6. Name it **LocalAnt** and save.
7. Start a chat and ask: *"Run health check on my local app"*.

## Keep a fixed URL (don't recreate the connector every time)

By default LocalAnt uses a **cloudflared Quick Tunnel**
(`https://xxxxx.trycloudflare.com`). That URL is **random and changes every time
you restart** — so you'd have to delete and recreate the ChatGPT connector each
session. The fix is to use a **fixed URL**. Because the auth token is persistent,
once the URL is stable you never recreate the connector or re-authenticate.

Set one of these (in the dashboard **Settings → Tunnel** tab, or with
`localant config set tunnel.<key> <value>`), then **Save & restart tunnel**:

### Option A — ngrok static domain (recommended, free)

1. Create a free account at <https://ngrok.com> and copy your **authtoken**.
2. In the ngrok dashboard, claim your free **static domain** (one per account,
   e.g. `myname.ngrok-free.app`).
3. Configure:
   ```bash
   localant config set tunnel.provider ngrok
   localant config set tunnel.token <your-ngrok-authtoken>
   localant config set tunnel.domain myname.ngrok-free.app
   ```
   Your endpoint is then always `https://myname.ngrok-free.app/mcp?key=<token>`.

### Option B — custom subdomain, no signup (localtunnel / serveo)

```bash
localant config set tunnel.provider localtunnel
localant config set tunnel.subdomain my-localant-mcp
```
Gives `https://my-localant-mcp.localtunnel.me` (best-effort — the subdomain isn't
reserved, so it can occasionally be taken).

### Option C — Cloudflare Named Tunnel (your own domain)

Create a Named Tunnel in the Cloudflare Zero Trust dashboard, then:
```bash
localant config set tunnel.provider cloudflared
localant config set tunnel.token <cloudflare-tunnel-token>
localant config set tunnel.publicUrl https://mcp.yourdomain.com
```

After any of these, restart the tunnel (dashboard **Save & restart tunnel**, or
`localant restart`) and paste the new stable URL into ChatGPT **once**.

## Authentication

The gateway requires the auth token. Two ways to provide it:

- **In the URL** (default): `/mcp?key=<token>` — works everywhere.
- **Header**: `Authorization: Bearer <token>` — if your connector supports
  custom headers.

`POST /mcp` without a valid token returns **401**. `GET`/`DELETE /mcp` return 405
(the endpoint is POST-only, stateless Streamable HTTP).

Find your URL again anytime:

```bash
localant status        # shows MCP URL
# or in the dashboard Home tab → Copy
```

## Try it

> - "Show the git diff of ~/Documents/my-app and review it."
> - "Read the README in ~/Documents/my-app."
> - "Create a new skill named qiita-private-post (don't enable it yet)."
> - "Ask Claude Code to plan SEO improvements for ~/Documents/my-app."

ChatGPT will call tools like `git_diff`, `fs_read_file`,
`skill_generate_from_prompt`, and `coding_agent_plan`. Risky actions will ask you
to approve in the dashboard or CLI.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | liveness |
| GET | `/status` | runtime info |
| POST | `/mcp` | MCP Streamable HTTP (auth required) |
