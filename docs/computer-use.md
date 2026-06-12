# Computer Use (desktop control)

`LocalAnt` can give ChatGPT eyes and hands on your desktop: take screenshots,
move the mouse, click, drag, type, and press keyboard shortcuts. Every action
goes through the gateway's approval pipeline and audit log.

**macOS-only for now.** Screenshots use the built-in `screencapture`/`sips`
binaries; mouse and keyboard input uses [`cliclick`](https://github.com/BlueM/cliclick).

## Prerequisites

1. Install cliclick: `brew install cliclick` (only needed for input tools —
   screenshots work without it).
2. Grant **Screen Recording** permission to the app running LocalAnt
   (System Settings → Privacy & Security → Screen Recording). Needed for
   `computer_screenshot`.
3. Grant **Accessibility** permission to the same app
   (System Settings → Privacy & Security → Accessibility). Needed for all
   mouse/keyboard tools.
4. Set the tool profile to `full` — computer tools are not exposed in the
   `minimal` or `coding` profiles:
   `localant config set tools.profile full`.

> The "app running LocalAnt" is whatever launched the process: Terminal,
> iTerm2, or a service manager. macOS prompts on first use; if an action
> silently does nothing, check these two permission panes.

## Coordinate system

`computer_screenshot` resamples the captured image to the display's **logical
resolution** (points), so a pixel position in the returned image maps 1:1 to
the `x`,`y` coordinates accepted by the click/move/drag tools — no Retina
scale-factor math needed. The screenshot is returned to ChatGPT inline as an
MCP image and also saved to the workspace directory.

## Available tools

| Tool | Risk | Description |
|------|------|-------------|
| `computer_screenshot` | 1 | Screenshot of the main display (inline image + saved file) |
| `computer_screen_info` | 0 | Logical resolution of the main display |
| `computer_cursor_position` | 0 | Current mouse position |
| `computer_list_apps` | 0 | Visible running apps + frontmost app |
| `computer_open_app` | 2 | Open / focus an application by name |
| `computer_move_mouse` | 1 | Move the cursor without clicking |
| `computer_left_click` | 3 | Left-click at (x, y) |
| `computer_double_click` | 3 | Double-click at (x, y) |
| `computer_right_click` | 3 | Right-click at (x, y) |
| `computer_drag` | 3 | Drag from (x1, y1) to (x2, y2) |
| `computer_type` | 3 | Type text at the current focus |
| `computer_paste_text` | 3 | Clipboard + Cmd+V paste (long text; overwrites clipboard) |
| `computer_key` | 3 | Press a key, optionally with cmd/shift/alt/ctrl/fn |
| `computer_scroll` | 3 | Scroll via Page Up/Down key presses |

## Security

- All input actions (click, type, key, drag, paste) are **risk 3**: in
  `strict` mode each one requires local approval; in `open` mode they run
  without approval but are always **audited**.
- A desktop screenshot can capture anything on screen — notifications,
  password managers, other windows. Treat `computer_screenshot` output as
  sensitive; it is risk 1 (no approval by default) so review what's visible
  before asking ChatGPT to look at your screen.
- `computer_paste_text` overwrites your system clipboard.

## Limitations

- macOS only (Linux/Windows support would need `xdotool` / PowerShell
  equivalents and is not implemented yet).
- Main display only; multi-monitor capture is not supported.
- `computer_scroll` sends Page Up/Down to the focused element rather than
  synthesizing scroll-wheel events (cliclick has no scroll support) — click
  the target area first.

## Example

> "Take a screenshot, open Notes, and type a shopping list into a new note."
