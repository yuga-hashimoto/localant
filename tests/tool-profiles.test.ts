import { describe, it, expect } from "vitest";
import { isToolInProfile, MINIMAL_PROFILE_TOOLS, CODING_PROFILE_TOOLS, defaultConfig } from "@localant/shared";

const AUTOPILOT_TOOLS = [
  "localant_autopilot_start",
  "localant_autopilot_status",
  "localant_autopilot_get_logs",
  "localant_autopilot_get_diff",
  "localant_autopilot_continue",
  "localant_autopilot_stop",
  "localant_autopilot_run_validation",
] as const;

describe("tool profiles", () => {
  it("defaults the config to the minimal profile", () => {
    expect(defaultConfig().tools.profile).toBe("minimal");
  });

  it("keeps the three delegation pillars in the minimal surface", () => {
    expect(MINIMAL_PROFILE_TOOLS.has("shell_run_allowed_command")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("coding_agent_start_task")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("skill_run")).toBe(true);
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
      "mcp_server_unregister",
      "mcp_server_run_tool",
    ]) {
      expect(MINIMAL_PROFILE_TOOLS.has(name)).toBe(false);
    }
  });

  it("minimal profile only admits listed tools", () => {
    expect(isToolInProfile("shell_run_allowed_command", "minimal")).toBe(true);
    expect(isToolInProfile("git_commit", "minimal")).toBe(false);
  });

  it("full profile admits every tool", () => {
    expect(isToolInProfile("git_commit", "full")).toBe(true);
    expect(isToolInProfile("anything_at_all", "full")).toBe(true);
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
      "agent_run",
      "lsp_diagnostics",
      "lsp_document_symbols",
      "approval_request",
    ]) {
      expect(isToolInProfile(name, "coding"), `missing ${name}`).toBe(true);
    }
  });

  it("coding profile exposes the Autopilot tools", () => {
    for (const name of AUTOPILOT_TOOLS) {
      expect(isToolInProfile(name, "coding"), `missing ${name}`).toBe(true);
    }
  });

  it("coding profile is a superset of minimal", () => {
    for (const name of MINIMAL_PROFILE_TOOLS) {
      expect(CODING_PROFILE_TOOLS.has(name), `coding missing minimal tool ${name}`).toBe(true);
    }
  });

  it("coding profile hides destructive/authoring tools and ChatGPT-duplicates", () => {
    // websearch/webfetch/todowrite/question excluded: ChatGPT does those natively.
    // approval_approve excluded: ChatGPT must not self-approve.
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
    // Each removed alias must still be reachable via the kept canonical name.
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
