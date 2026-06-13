# Local Backup

Create and list timestamped `.tar.gz` snapshots of a local folder.

Backing up files on your machine is a local-only chore: ChatGPT can _ask_ for a
backup before a risky change, but only local hands can make one. This skill is
those hands.

## Tools

| Tool | Risk | What it does |
|------|------|--------------|
| `local_backup_create` | 2 | Snapshot a directory into `<name>-<timestamp>.tar.gz`. |
| `local_backup_list` | 0 | List archives in the workspace (or a given `outDir`). |

`tar` is invoked with an argv array (never a shell string), so there is no
command-injection surface and paths with spaces are safe.

## Permissions

- `filesystem: read` — to read the folder being archived.
- `shell: allowlist` with only `tar`.
- No network, secrets, browser, or agent access.

## Example

```jsonc
// local_backup_create — archive lands in the skill workspace by default
{ "dir": "/Users/you/code/myapp" }

// or choose where it goes
{ "dir": "/Users/you/code/myapp", "outDir": "/Users/you/Backups" }

// local_backup_list
{ "outDir": "/Users/you/Backups" }
```

## Try it

```bash
localant skills install <git-url-of-this-folder>   # or copy into ~/.localant/skills
localant skills validate local-backup
localant skills enable local-backup                # requires approval
```
