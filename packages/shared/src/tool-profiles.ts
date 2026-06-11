/**
 * Tool exposure profiles.
 *
 * The gateway registers ~200 built-in tools, but exposing all of them to an MCP
 * client (ChatGPT) hurts tool-selection accuracy and bloats every request. Three
 * profiles trade surface area against capability:
 *
 *  - `minimal` (legacy default): the small delegation core — shell allowlist,
 *    coding agent, skill, read-only fs, MCP bridge, control plane.
 *  - `coding`: the surface needed to use ChatGPT itself as a coding agent —
 *    read/write/edit/multi_edit/apply_patch, grep/glob, bash, git, project
 *    validation, todo/task/plan, question, agent delegation, MCP, webfetch,
 *    basic browser.
 *  - `full`: every registered tool (browser full, adb, skill authoring, config
 *    mutation, secret management, destructive git, …).
 */
export type ToolProfile = "minimal" | "coding" | "full";

/**
 * The set of tool names exposed in the `minimal` profile. Everything else is
 * reachable only in the `coding` / `full` profiles — or, preferably, via shell /
 * a coding agent / a skill.
 */
export const MINIMAL_PROFILE_TOOLS: ReadonlySet<string> = new Set<string>([
  // --- Control plane / status (cannot be delegated) ---
  "health_check",
  "get_app_status",
  "get_version",
  "get_config",
  "get_dashboard_url",
  "get_mcp_endpoint",
  "get_tunnel_status",

  // --- Approvals + audit (read-only; the human approves in the dashboard) ---
  "approval_list_pending",
  "approval_get",
  "audit_list_logs",
  "audit_get_log",
  "audit_search_logs",

  // --- Pillar 1: Shell ---
  "shell_run_allowed_command",
  "shell_request_command_approval",
  "shell_run_approved_command",
  "shell_list_allowed_commands",
  "shell_list_processes",
  "shell_get_process_output",
  "shell_stop_process",

  // --- Pillar 2: coding Agent ---
  "coding_agent_list",
  "coding_agent_status",
  "coding_agent_plan",
  "coding_agent_start_task",
  "coding_agent_get_task",
  "coding_agent_get_logs",
  "coding_agent_stop_task",
  "coding_agent_continue_task",
  "coding_agent_get_result",
  "coding_agent_get_diff",
  "coding_agent_run_validation",

  // --- Pillar 3: Skill ---
  "skill_list",
  "skill_info",
  "skill_run",
  "skill_search_registry",
  "skill_install_from_git",

  // --- Read-only filesystem (lightweight read path) ---
  "fs_list_allowed_directories",
  "fs_list_files",
  "fs_read_file",
  "fs_read_file_range",
  "fs_search_files",
  "fs_search_content",
  "fs_get_file_info",

  // --- MCP bridge ---
  "mcp_server_list",
  "mcp_server_register",
  "mcp_server_unregister",
  "mcp_server_status",
  "mcp_server_list_tools",
  "mcp_server_run_tool",
]);

/**
 * The set of tool names exposed in the `coding` profile. This is the surface a
 * person would want when driving ChatGPT as a local coding agent: read/search,
 * edit, run, validate, commit, plan, delegate. It is a superset of the minimal
 * status/approval/audit/MCP surface plus the standard Codex / Claude
 * Code-style tool names.
 */
export const CODING_PROFILE_TOOLS: ReadonlySet<string> = new Set<string>([
  ...MINIMAL_PROFILE_TOOLS,

  // --- Filesystem / code editing (standard names + aliases) ---
  "read",
  "read_file",
  "read_file_range",
  "write",
  "write_file",
  "edit",
  "edit_file",
  "multi_edit",
  "apply_patch",
  "list_files",
  "glob",
  "grep",
  "search_content",
  "search_files",
  "get_file_info",
  "create_directory",
  "move_file",
  "copy_file",
  "delete_file",
  "diff_file",

  // --- Shell / bash ---
  "bash",
  "shell_run",
  "shell_run_background",
  "shell_get_output",
  "shell_stop",
  "bash_output",
  "kill_shell",
  "command_exists",

  // --- Git ---
  "git_status",
  "git_diff",
  "git_diff_file",
  "git_list_changed_files",
  "git_log",
  "git_branch",
  "git_checkout",
  "git_checkout_new_branch",
  "git_add",
  "git_commit",
  "git_restore",
  "git_stash",
  "git_clean_preview",
  "git_apply_patch",
  "git_create_patch",
  "git_get_current_branch",
  "git_is_dirty",

  // --- Project / validation ---
  "project_get_package_scripts",
  "project_install_deps",
  "project_run_tests",
  "project_run_lint",
  "project_run_typecheck",
  "project_run_format",
  "project_run_build",
  "project_run_validation",

  // --- Human interaction ---
  // NOTE: no todo/plan/task or question/ask_user tools — ChatGPT plans and asks
  // the user natively, so tool-ifying those only bloats the surface. Only the
  // local security-gating request is exposed; ChatGPT must NOT self-approve, so
  // approval_approve/approval_deny are deliberately excluded (human approves in
  // the dashboard / CLI).
  "approval_request",

  // --- Agent delegation (aliases over coding_agent_*) ---
  "agent_list",
  "agent_status",
  "agent_run",
  "agent_plan",
  "agent_continue",
  "agent_stop",
  "agent_get_logs",
  "agent_get_result",
  "agent_get_diff",
  "agent_run_validation",

  // --- LSP / code intelligence ---
  "lsp_status",
  "lsp_list_servers",
  "lsp_diagnostics",
  "lsp_document_symbols",
  "lsp_go_to_definition",
  "lsp_find_references",
  "lsp_hover",
  "lsp_workspace_symbols",
  "lsp_rename_symbol",


  // --- Basic browser ---
  "browser_open",
  "browser_close",
  "browser_screenshot",
  "browser_extract_text",
  "browser_get_url",
  "browser_wait",

  // --- MCP import ---
  "mcp_import_claude_config",
  "mcp_import_codex_config",
  "mcp_import_opencode_config",
  "mcp_import_all_agent_configs",

  // --- Tunnel control ---
  "tunnel_start",
  "tunnel_stop",
  "tunnel_restart",
]);

/** Whether a tool is exposed under the given profile. `full` exposes everything. */
export function isToolInProfile(name: string, profile: ToolProfile): boolean {
  if (profile === "full") return true;
  if (profile === "coding") return CODING_PROFILE_TOOLS.has(name);
  return MINIMAL_PROFILE_TOOLS.has(name);
}
