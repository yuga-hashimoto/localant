# ChatGPT UI widgets

LocalAnt exposes ChatGPT Apps SDK widgets through MCP resource templates. The widgets are rendered inside ChatGPT when a matching tool result includes `openai/outputTemplate` metadata.

## Open the LocalAnt home panel

Ask ChatGPT to call:

```text
localant_ui
```

The tool is read-only and available in every tool profile. It opens a LocalAnt Home widget with:

- gateway, dashboard, tunnel, and MCP endpoint status
- current security mode and exposed tool count
- pending approvals
- tracked background processes
- registered downstream MCP servers
- installed skills
- recent audit events

The panel also has lightweight inspect actions that call read-only/view tools from the widget runtime and render the returned JSON inline.

## Existing panels

LocalAnt also binds focused widgets to existing view tools:

| Panel | Tools |
| --- | --- |
| Approval Center | `approval_list_pending`, `approval_get` |
| Git Panel | `git_status`, `git_list_changed_files`, `git_diff` |
| Shell Panel | `shell_list_processes`, `shell_get_process_output` |
| Browser Panel | `browser_open`, `browser_get_url`, `browser_console_logs`, `browser_extract_text` |
| ADB Panel | `adb_list_devices`, `adb_get_current_activity`, `adb_dump_ui`, `adb_logcat` |
| MCP Panel | `mcp_server_list`, `mcp_server_list_tools`, `mcp_server_status` |
| Skill Panel | `skill_list`, `skill_info` |
| Image Viewer | result-level widget for image-returning tools such as `fs_read_image` and `computer_screenshot` |

## Implementation notes

- Widget resources live under `packages/mcp/src/widgets/*`.
- Tool descriptor metadata is produced by `widgetMetaForTool()`.
- Result-level image metadata is produced by `imageWidgetMeta()` only when a tool actually returns image bytes.
- Widgets are self-contained HTML documents assembled by `widgetDocument()` and use `window.openai.callTool()` for interactive read-only drilldowns.
- Resource MIME type is `text/html;profile=mcp-app`; each resource also carries the Apps SDK metadata keys used by ChatGPT.

## Safety model

The UI does not bypass LocalAnt's gateway. Every button-triggered call still flows through the same registry, risk policy, approval queue, audit log, and session scoping as normal ChatGPT tool calls.
