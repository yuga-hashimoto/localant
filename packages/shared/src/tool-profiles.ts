/**
 * Tool exposure profiles.
 *
 * The gateway registers ~140 built-in tools, but exposing all of them to an MCP
 * client (ChatGPT) hurts tool-selection accuracy and bloats every request. The
 * design intent is the opposite: keep the advertised surface small and push the
 * actual work onto three delegation pillars —
 *
 *   1. Shell        — run commands (`shell_run_allowed_command`, …)
 *   2. coding Agent — hand a task to Claude Code / Codex / etc.
 *   3. Skill        — invoke a packaged skill
 *
 * plus the things those pillars cannot do for themselves: a read-only filesystem
 * path (cheaper than spinning up an agent just to read a file), read-only project
 * context, the MCP bridge (connect downstream MCP servers and proxy their tools),
 * and the control plane (status, approvals, audit).
 *
 *  - `minimal` (default): only the core surface listed in {@link MINIMAL_PROFILE_TOOLS}.
 *  - `full`: every registered tool (browser, adb, git, article publishers, MCP
 *    adapters, filesystem writes, skill authoring, …).
 */
export type ToolProfile = "minimal" | "full";

/**
 * The set of tool names exposed in the `minimal` profile. Everything else is
 * reachable only in the `full` profile — or, preferably, via shell / a coding
 * agent / a skill.
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

  // --- Read-only project context ---
  "project_list",
  "project_get",
  "project_status",
  "project_detect_stack",

  // --- MCP bridge: connect downstream MCP servers and proxy their tools ---
  // Lets LocalAnt act as a hub — register an external stdio MCP server and call
  // its tools through mcp_server_run_tool. Kept in the minimal surface because
  // connecting a server is a deliberate, opt-in action.
  "mcp_server_list",
  "mcp_server_register",
  "mcp_server_unregister",
  "mcp_server_status",
  "mcp_server_list_tools",
  "mcp_server_run_tool",
]);

/** Whether a tool is exposed under the given profile. `full` exposes everything. */
export function isToolInProfile(name: string, profile: ToolProfile): boolean {
  return profile === "full" || MINIMAL_PROFILE_TOOLS.has(name);
}
