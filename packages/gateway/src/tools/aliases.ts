import type { Gateway } from "../gateway.js";

/**
 * Register `alias` as a thin wrapper over an already-registered `target` tool.
 * The alias shares the target's schema and handler so the safety pipeline is
 * identical; risk can be overridden. Must run AFTER all targets are registered.
 */
function registerAlias(
  gw: Gateway,
  alias: string,
  target: string,
  overrides?: { risk?: 0 | 1 | 2 | 3 | 4; description?: string },
): void {
  if (gw.registry.get(alias)) return; // never clobber an existing tool
  const def = gw.registry.get(target);
  if (!def) throw new Error(`alias '${alias}' -> unknown target '${target}'`);
  gw.registry.register({
    name: alias,
    description: overrides?.description ?? `(alias of ${target}) ${def.description}`,
    risk: overrides?.risk ?? def.risk,
    inputSchema: def.inputSchema,
    summarize: def.summarize,
    handler: def.handler,
  });
}

/**
 * Standard Codex / Claude Code / OpenCode tool names mapped onto LocalAnt's
 * existing tools. Existing names are never removed — these are additive.
 */
export function registerAliasTools(gw: Gateway): void {
  // --- Filesystem / editing ---
  registerAlias(gw, "read", "fs_read_file");
  registerAlias(gw, "read_file", "fs_read_file");
  registerAlias(gw, "read_file_range", "fs_read_file_range");
  registerAlias(gw, "write", "fs_create_file");
  registerAlias(gw, "write_file", "fs_create_file");
  registerAlias(gw, "edit_file", "edit");
  registerAlias(gw, "list_files", "fs_list_files");
  registerAlias(gw, "search_content", "fs_search_content");
  registerAlias(gw, "search_files", "fs_search_files");
  registerAlias(gw, "get_file_info", "fs_get_file_info");
  registerAlias(gw, "move_file", "fs_move_file");
  registerAlias(gw, "delete_file", "fs_delete_file_with_approval");
  registerAlias(gw, "diff_file", "git_diff_file");
  registerAlias(gw, "snapshot_file", "fs_backup_file");
  registerAlias(gw, "restore_file_snapshot", "fs_restore_backup");

  // --- Shell / bash ---
  registerAlias(gw, "shell_run", "bash");
  registerAlias(gw, "bash_output", "shell_get_output");
  registerAlias(gw, "kill_shell", "shell_stop");

  // --- Git ---
  registerAlias(gw, "git_checkout", "git_checkout_branch");
  registerAlias(gw, "git_checkout_new_branch", "git_create_branch");
  registerAlias(gw, "git_restore", "git_restore_file");

  // --- Browser (local automation; no web_* aliases — those imply ChatGPT's own
  // web browsing, which it already does). ---
  registerAlias(gw, "browser_wait", "browser_wait_for");

  // NOTE: agent_* / coding_agent_* delegation aliases were retired. The agent
  // CLIs are no longer public tools — ChatGPT delegates via the high-level
  // `autopilot` tool, which selects an internal provider from Autopilot Settings.
}
