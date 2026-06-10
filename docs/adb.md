# Android / ADB

`chatgpt-local-app` can control an Android device or emulator via `adb` when
you explicitly opt in. All ADB tools are gated behind the gateway's approval
pipeline.

## Prerequisites

1. Enable USB debugging on your device.
2. Authorize your computer (`adb devices` once).
3. Confirm `adb` is on PATH: `chatgpt-local-app doctor`.

## Available tools

| Tool | Risk | Description |
|------|------|-------------|
| `adb_list_devices` | 0 | List connected devices/emulators |
| `adb_get_current_activity` | 0 | Get the currently focused activity |
| `adb_screenshot` | 2 | Screenshot (saved to workspace) |
| `adb_pull_screenshot` | 2 | Pull latest screenshot from device |
| `adb_tap` | 3 | Tap at (x, y) coordinates |
| `adb_swipe` | 3 | Swipe from (x1,y1) to (x2,y2) |
| `adb_input_text` | 3 | Type text into the focused field |
| `adb_keyevent` | 3 | Send a key event (back, home, etc) |
| `adb_logcat` | 2 | Dump the logcat buffer |
| `adb_clear_logcat` | 3 | Clear the logcat buffer |
| `adb_start_app` | 3 | Launch a package by name |
| `adb_stop_app` | 3 | Force-stop a package |
| `adb_install_apk` | 3 | Install an .apk from the local filesystem |

## Security

- `adb_install_apk` is risk 3 and requires **approval**.
- All input text is **audited**.
- Destructive operations (force-stop, clear-logcat, install) are risk 3+.

## Example

> "Take a screenshot of my connected Android device."

ChatGPT calls `adb_list_devices`, then `adb_screenshot`. The file lands in the
workspace directory (`~/Library/Application Support/chatgpt-local-app/workspace`).

## FAQ

- **Emulator support?** Yes — anything `adb devices` lists.
- **Multiple devices?** Specify the serial via `adb -s <serial>` first.
- **Wireless debugging?** Configure adb to connect over TCP, then use as normal.
