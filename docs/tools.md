# Tools & Risk Levels

Every tool LocalAnt exposes carries a **risk level** (0–4). The risk level drives
the MCP annotation hints sent to ChatGPT and how the gateway gates the call
(approval in `strict`, audited-but-ungated in `open`, ungated in `yolo` — with
`CORE_BLOCKED_COMMAND_TOKENS` rejected even in `yolo`).

## Risk scale

| Risk | Label | Meaning | Gated in `strict` |
|------|-------|---------|-------------------|
| 0 | read-only | Reads state, modifies nothing. | No |
| 1 | safe-write-draft | Writes a new draft; destroys no existing data. | No (unless `approveRisk1`) |
| 2 | file-modification | Modifies/deletes local files. | Yes |
| 3 | shell / agent / network-write | Runs commands, drives agents, talks to devices/network. | Yes |
| 4 | destructive / publish / deploy | Irreversible or external (publish, hard reset, secret reveal). | Yes (often double-approval) |

Annotations always reflect a tool's *actual* behavior — they are **not** relaxed
in `yolo` mode, so a client is never told a mutating tool is read-only.

## Tool families

The catalog is ~228 tools. Risk varies *within* a family by operation (a `git_status`
is risk 0; a `git_reset --hard` is risk 4), so ranges are shown.

| Family | Tools | Risk range | Notes |
|--------|------:|------------|-------|
| Read / Search | 7 | 0 | `read`, `read_file_range`, `grep`, `glob`, `list_files`, `get_file_info`. Never mutates. |
| Edit | 10 | 2–3 | `write`, `edit`, `multi_edit`, `apply_patch`, `move_file`, `copy_file`, `create_directory`, `delete_file`. |
| Asset bridge | 1 | 2 | `asset_save_image` — one tool, `source.kind` = `base64` / `url` / `latest_download`. Magic-byte + SSRF + SVG-safety checked. See [asset-bridge.md](asset-bridge.md). |
| Shell | 16 | 0–3 | `bash`, background shell control, `command_exists`. Screened by CommandGuard + PathGuard. |
| Git | 22 | 0–4 | Status/diff/log are 0; `git_commit`/`git_add` are 2–3; `git_reset`/destructive ops reach 4. |
| Validate / Project | 8 | 0–3 | `project_run_tests`/`lint`/`typecheck`/`build`/`validation`; reads scripts at 0. |
| Code intel (LSP) | 9 | 0–2 | `lsp_*` — diagnostics/symbols/hover at 0; `lsp_rename_symbol` mutates (2). |
| Coding agents | 13 | 0–3 | `coding_agent_*`, `agent_run`. Plans/reads at 0; execute/continue/validate at 3. |
| Skills | 14 | 0–4 | List/info/validate at 0; create/run at 2–3; `skill_publish_to_git` at 4. |
| Browser | 17 | 1–4 | Playwright in an isolated profile; navigation/read low, downloads/uploads high. |
| Android (ADB) | 20 | 0–3 | Device read at 0; input/install/file-push at 2–3. |
| Computer Use | 14 | 0–3 | `screenshot` at 0; mouse/keyboard input at 3. macOS only. See [computer-use.md](computer-use.md). |
| MCP adapters | 10 | 0–3 | Bridge to downstream MCP servers; risk mirrors the proxied tool. |
| Secrets | 3 | 0–4 | List names at 0; reveal/use a secret value at 4. Values are redacted in audit. |
| Approve / Audit | 9 | 0 | `approval_request`, approval queue, and audit reads — never mutate the machine. |
| Control plane | — | 0–3 | Config, profile, autopilot, aliases, system info, `ask`-style control tools. |

> The exact risk of any single tool is the source of truth in code
> (`risk:` on each `r.register({...})`). `localant tools list` prints
> `name [risk N]` for the tools exposed under your active profile, and the MCP
> annotations are derived in [`packages/shared/src/risk.ts`](../packages/shared/src/risk.ts).

## Profiles

The advertised surface is narrowed by the active **tool profile**:

- `minimal` — delegation core (shell / agent / skill + read-only fs).
- `coding` — the full coding surface (read/edit/run/git/validate/LSP/agents).
- `full` — every tool (browser, ADB, computer use, skill authoring, secrets, destructive git).

```bash
localant tools profile coding
localant tools list
```
