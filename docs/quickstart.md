# Quickstart

## Requirements
- Node.js 20+ (22+ recommended; skill execution uses native TS type-stripping).
- `git` on PATH.
- Optional: `pnpm`, `claude`, `codex`, `tailscale` (default tunnel), `cloudflared`/`ngrok` fallbacks, `adb`, `docker`.

Run `localant doctor` to check.

## Install & run

```bash
npx -y localant setup
# or
npm install -g localant
localant setup
```

From source (this repo):

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.js setup
```

## What setup does
1. Environment check (`doctor`).
2. Create the config directory and default `config.json`.
3. Generate an auth token and initialize the secret vault, audit log, approvals.
4. Set default allowed directories (`~/Projects`, `~/Developer`,
   `~/Documents/LocalAnt`) and allowed commands.
5. Start the gateway (`:8787`) and dashboard (`:8788`).
6. Start a public tunnel and print/copy the MCP URL.
7. Open the dashboard in your browser.

## Verify
- Visit `http://127.0.0.1:8788` (dashboard) and click **Run** under Health check.
- Or in ChatGPT after connecting: *"Run health check on my local app"*.

## Common commands

```bash
localant status
localant logs
localant approvals list
localant skills list
localant agents run claude-code ~/Documents/my-app "Plan SEO improvements"
localant secrets set QIITA_TOKEN
```
