# Quickstart

## Requirements
- Node.js 20+ (22+ recommended; skill execution uses native TS type-stripping).
- `git` on PATH.
- Optional: `pnpm`, `claude`, `codex`, `cloudflared`/`ngrok`, `adb`, `docker`.

Run `chatgpt-local-app doctor` to check.

## Install & run

```bash
npx -y chatgpt-local-app setup
# or
npm install -g chatgpt-local-app
chatgpt-local-app setup
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
   `~/Documents/chatgpt-local-app`) and allowed commands.
5. Start the gateway (`:8787`) and dashboard (`:8788`).
6. Start a public tunnel and print/copy the MCP URL.
7. Open the dashboard in your browser.

## Verify
- Visit `http://127.0.0.1:8788` (dashboard) and click **Run** under Health check.
- Or in ChatGPT after connecting: *"Run health check on my local app"*.

## Common commands

```bash
chatgpt-local-app status
chatgpt-local-app logs
chatgpt-local-app approvals list
chatgpt-local-app skills list
chatgpt-local-app projects add ~/Projects/my-app
chatgpt-local-app secrets set QIITA_TOKEN
```
