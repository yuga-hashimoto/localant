# File Organizer

Tidy a local folder by sorting its files into subfolders — **by type**
(`images/`, `documents/`, `archives/`, …) or **by date** (`2026-06/`).

This is a canonical "local hands" skill: ChatGPT can _decide_ your Downloads
folder is a mess, but it can't move the files. This skill can.

## Tools

| Tool | Risk | What it does |
|------|------|--------------|
| `file_organizer_plan` | 0 | Preview the moves. Makes **no** changes. |
| `file_organizer_apply` | 2 | Move top-level files into buckets (approval required). |

Only top-level files are touched — subdirectories and dotfiles are left alone,
so re-running is safe and idempotent. A file is skipped (not overwritten) if a
same-named file already exists in its target bucket.

## Permissions

`filesystem: write`. Add the folders you want it to manage to the skill's
`allowedDirectories` (or rely on the gateway's allowed directories in strict
mode). No shell, network, or secrets.

## Example

```jsonc
// file_organizer_plan
{ "dir": "/Users/you/Downloads", "by": "type" }

// file_organizer_apply
{ "dir": "/Users/you/Downloads", "by": "date" }
```

## Try it

```bash
localant skills install <git-url-of-this-folder>   # or copy into ~/.localant/skills
localant skills validate file-organizer
localant skills enable file-organizer              # requires approval
```
