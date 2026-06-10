# Connecting ChatGPT

1. Open **ChatGPT → Settings → Apps & Connectors**.
2. Open **Advanced settings** and turn **Developer Mode ON**.
3. Go to **Connectors → Create**.
4. Paste the **Connector URL** shown by `setup`:
   ```
   https://xxxxx.trycloudflare.com/mcp?key=<token>
   ```
5. Name it **LocalAnt** and save.
6. Start a chat and ask: *"Run health check on my local app"*.

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

> - "List my registered projects."
> - "Show the git diff of my-app and review it."
> - "Read the README in ~/Projects/my-app."
> - "Create a new skill named qiita-private-post (don't enable it yet)."
> - "Ask Claude Code to plan SEO improvements for my-app."

ChatGPT will call tools like `project_list`, `git_diff`, `fs_read_file`,
`skill_generate_from_prompt`, and `coding_agent_plan`. Risky actions will ask you
to approve in the dashboard or CLI.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | liveness |
| GET | `/status` | runtime info |
| POST | `/mcp` | MCP Streamable HTTP (auth required) |
