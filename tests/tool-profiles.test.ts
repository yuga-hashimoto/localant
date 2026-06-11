import { describe, it, expect } from "vitest";
import { isToolInProfile, MINIMAL_PROFILE_TOOLS, CODING_PROFILE_TOOLS, defaultConfig } from "@localant/shared";

describe("tool profiles", () => {
  it("defaults the config to the minimal profile", () => {
    expect(defaultConfig().tools.profile).toBe("minimal");
  });

  it("keeps the three delegation pillars in the minimal surface", () => {
    expect(MINIMAL_PROFILE_TOOLS.has("shell_run_allowed_command")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("coding_agent_start_task")).toBe(true);
    expect(MINIMAL_PROFILE_TOOLS.has("skill_run")).toBe(true);
  });

  it("exposes the MCP bridge tools in the minimal surface", () => {
    for (const name of [
      "mcp_server_list",
      "mcp_server_register",
      "mcp_server_unregister",
      "mcp_server_status",
      "mcp_server_list_tools",
      "mcp_server_run_tool",
    ]) {
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
    for (const name of ["bash", "read", "write", "edit", "multi_edit", "apply_patch", "grep", "glob", "git_diff", "project_run_validation", "todowrite", "question", "agent_run"]) {
      expect(isToolInProfile(name, "coding"), `missing ${name}`).toBe(true);
    }
  });

  it("coding profile is a superset of minimal", () => {
    for (const name of MINIMAL_PROFILE_TOOLS) {
      expect(CODING_PROFILE_TOOLS.has(name), `coding missing minimal tool ${name}`).toBe(true);
    }
  });

  it("coding profile still hides destructive/authoring tools", () => {
    for (const name of ["git_reset_hard", "secret_remove", "skill_create", "adb_tap", "browser_evaluate"]) {
      expect(isToolInProfile(name, "coding"), name).toBe(false);
    }
  });
});
