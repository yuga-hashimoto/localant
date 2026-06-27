import { describe, it, expect } from "vitest";
import { isToolInProfile, MINIMAL_PROFILE_TOOLS, CODING_PROFILE_TOOLS, defaultConfig } from "@localant/shared";

/** The per-agent delegation tools that were retired in favor of `autopilot`.
 * None of them may appear in any non-`full` advertised profile. */
const RETIRED_AGENT_TOOLS = [
  "agent_run",
  "agent_list",
  "agent_status",
  "agent_plan",
  "agent_continue",
  "agent_stop",
  "agent_get_logs",
  "agent_get_result",
  "agent_get_diff",
  "agent_run_validation",
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
  "localant_autopilot_start",
  "localant_autopilot_status",
  "localant_autopilot_get_logs",
  "localant_autopilot_get_diff",
  "localant_autopilot_continue",
  "localant_autopilot_stop",
  "localant_autopilot_run_validation",
] as const;

/** Low-level tools that must remain reachable. */
const LOW_LEVEL_TOOLS = [
  "shell_run_allowed_command",
  "bash",
  "git_status",
  "git_commit",
  "fs_read_file",
  "fs_create_file",
  "browser_open",
  "adb_tap",
  "browser_screenshot",
] as const;

describe("tool profiles", () => {
  it("defaults the config to the minimal profile", () => {
    expect(defaultConfig().tools.profile).toBe("minimal");
    expect(defaultConfig().tools.features.videoStudio).toBe(false);
    expect(defaultConfig().tools.features.assetBridge).toBe(false);
  });

  it("exposes the high-level autopilot + doctor surface in the minimal profile", () => {
    expect(MINIMAL_PROFILE_TOOLS.has("autopilot")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("localant_doctor")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("shell_run_allowed_command")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("skill_run")).toBe(true);
  });

  it("excludes every retired agent-style tool from the minimal AND coding profiles", () => {
    for (const name of RETIRED_AGENT_TOOLS) {
      expect(MINIMAL_PROFILE_TOOLS.has(name), `minimal still has ${name}`).toBe(false);
      expect(CODING_PROFILE_TOOLS.has(name), `coding still has ${name}`).toBe(false);
      expect(isToolInProfile(name, "minimal"), `minimal admits ${name}`).toBe(false);
      expect(isToolInProfile(name, "coding"), `coding admits ${name}`).toBe(false);
    }
  });

  it("keeps the low-level operation tools available in the coding profile", () => {
    for (const name of ["shell_run_allowed_command", "bash", "git_status", "git_commit", "browser_open"]) {
      expect(isToolInProfile(name, "coding"), `coding missing ${name}`).toBe(true);
    }
  });

  it("keeps the low-level operation tools available in the full profile", () => {
    for (const name of LOW_LEVEL_TOOLS) {
      expect(isToolInProfile(name, "full"), `full missing ${name}`).toBe(true);
    }
  });

  it("exposes only read/status MCP bridge tools in the minimal surface", () => {
    for (const name of ["mcp_server_list", "mcp_server_status", "mcp_server_list_tools"]) {
      expect(MINIMAL_PROFILE_TOOLS.has(name), `missing ${name}`).toBe(true);
    }
  });

  it("excludes delegated / authoring tools from the minimal surface", () => {
    for (const name of [
      "browser_open",
      "adb_tap",
      "git_commit",
      "zenn_publish_article",
      "fs_create_file",
      "skill_create",
      "mcp_server_register",
    ]) {
      expect(MINIMAL_PROFILE_TOOLS.has(name)).toBe(false);
    }
  });

  it("minimal profile only admits listed tools", () => {
    expect(isToolInProfile("autopilot", "minimal")).toBe(true);
    expect(isToolInProfile("git_commit", "minimal")).toBe(false);
  });

  it("full profile admits every tool", () => {
    expect(isToolInProfile("git_commit", "full")).toBe(true);
    expect(isToolInProfile("anything_at_all", "full")).toBe(true);
  });

  it("hides plugin-style tools unless their dashboard feature is enabled", () => {
    const disabled = { videoStudio: false, assetBridge: false };
    const enabled = { videoStudio: true, assetBridge: true };

    for (const profile of ["minimal", "coding", "full"] as const) {
      expect(isToolInProfile("video_studio_status", profile, disabled), `${profile} video status`).toBe(false);
      expect(isToolInProfile("video_studio_generate_video", profile, disabled), `${profile} video render`).toBe(false);
      expect(isToolInProfile("asset_save_image", profile, disabled), `${profile} asset save`).toBe(false);
      expect(isToolInProfile("asset_upload_chunk", profile, disabled), `${profile} asset chunk`).toBe(false);
    }

    expect(isToolInProfile("video_studio_status", "minimal", enabled)).toBe(true);
    expect(isToolInProfile("video_studio_generate_video", "minimal", enabled)).toBe(false);
    expect(isToolInProfile("asset_save_image", "minimal", enabled)).toBe(false);
    expect(isToolInProfile("video_studio_generate_video", "coding", enabled)).toBe(true);
    expect(isToolInProfile("asset_save_image", "coding", enabled)).toBe(true);
    expect(isToolInProfile("video_studio_generate_video", "full", enabled)).toBe(true);
    expect(isToolInProfile("asset_save_image", "full", enabled)).toBe(true);
  });

  it("coding profile exposes the coding tools", () => {
    for (const name of [
      "bash",
      "read",
      "write",
      "edit",
      "multi_edit",
      "apply_patch",
      "grep",
      "glob",
      "git_diff",
      "project_run_validation",
      "autopilot",
      "lsp_diagnostics",
      "lsp_document_symbols",
      "approval_request",
    ]) {
      expect(isToolInProfile(name, "coding"), `missing ${name}`).toBe(true);
    }
  });

  it("coding profile is a superset of minimal", () => {
    for (const name of MINIMAL_PROFILE_TOOLS) {
      expect(CODING_PROFILE_TOOLS.has(name), `coding missing minimal tool ${name}`).toBe(true);
    }
  });

  it("coding profile hides destructive/authoring tools and ChatGPT-duplicates", () => {
    for (const name of [
      "git_reset_hard",
      "secret_remove",
      "skill_create",
      "adb_tap",
      "browser_evaluate",
      "websearch",
      "webfetch",
      "todowrite",
      "question",
      "approval_approve",
      "approval_deny",
    ]) {
      expect(isToolInProfile(name, "coding"), name).toBe(false);
    }
  });

  it("coding profile drops pure duplicate aliases (one name per function)", () => {
    const droppedToKept: Record<string, string> = {
      read_file: "read",
      read_file_range: "fs_read_file_range",
      write_file: "write",
      edit_file: "edit",
      list_files: "fs_list_files",
      search_content: "grep",
      search_files: "fs_search_files",
      get_file_info: "fs_get_file_info",
      diff_file: "git_diff_file",
      shell_run: "bash",
      bash_output: "shell_get_output",
      kill_shell: "shell_stop",
    };
    for (const [dropped, kept] of Object.entries(droppedToKept)) {
      expect(isToolInProfile(dropped, "coding"), `${dropped} should be dropped`).toBe(false);
      expect(isToolInProfile(kept, "coding"), `${kept} should remain`).toBe(true);
    }
  });
});
