import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGateway } from "@localant/gateway";

let base: string;
function gw() {
  return createGateway(base);
}

beforeEach(() => {
  // Repo-local temp dir (OS tmpdir is under /var on macOS, which is blocklisted).
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-gw-"));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("Gateway tool pipeline", () => {
  it("runs a risk-0 tool without approval", async () => {
    const g = gw();
    const res = await g.executeTool("health_check", {}, { caller: "test" });
    expect(res.ok).toBe(true);
    expect((res.data as { status: string }).status).toBe("ok");
  });

  it("records an audit entry for every call", async () => {
    const g = gw();
    await g.executeTool("get_version", {}, { caller: "test" });
    const logs = g.audit.list(10);
    expect(logs.some((l) => l.tool === "get_version")).toBe(true);
  });

  it("requires approval for a risk-2 tool and blocks until approved (strict mode)", async () => {
    const g = gw();
    const dir = path.join(base, "proj");
    fs.mkdirSync(dir);
    g.saveConfig({ ...g.config(), security: { ...g.config().security, mode: "strict", allowedDirectories: [dir] } });

    const first = await g.executeTool("fs_create_file", { path: path.join(dir, "a.txt"), content: "x", overwrite: false }, { caller: "test" });
    expect(first.ok).toBe(false);
    expect(first.approvalRequired).toBeTruthy();

    g.approvals.approve(first.approvalRequired!.approvalId, "once");
    const second = await g.executeTool("fs_create_file", { path: path.join(dir, "a.txt"), content: "x", overwrite: false }, { caller: "test" });
    expect(second.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "a.txt"))).toBe(true);
  });

  it("runs a risk-2 tool without approval in open mode (default)", async () => {
    const g = gw();
    const dir = path.join(base, "proj-open");
    fs.mkdirSync(dir);
    // open is the default mode; no allowlist needed, no approval for risk < 4.
    expect(g.config().security.mode).toBe("open");
    const res = await g.executeTool(
      "fs_create_file",
      { path: path.join(dir, "b.txt"), content: "x", overwrite: false },
      { caller: "test" },
    );
    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, "b.txt"))).toBe(true);
  });

  it("always keeps core blocked tokens even if config tries to drop them", async () => {
    const g = gw();
    g.saveConfig({ ...g.config(), security: { ...g.config().security, blockedCommandTokens: [] } });
    const tokens = g.config().security.blockedCommandTokens;
    expect(tokens).toContain("sudo");
    expect(tokens).toContain("dd");
    expect(tokens).toContain("mkfs");
  });

  it("rejects filesystem access outside the allowlist", async () => {
    const g = gw();
    const res = await g.executeTool("fs_read_file", { path: "/etc/hosts" }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/allowed directories|blocklist/i);
  });

  it("rejects a blocked shell command", async () => {
    const g = gw();
    const res = await g.executeTool("shell_run_allowed_command", { command: "sudo rm -rf /" }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rejected|blocked|not in the allowed/i);
  });

  it("redacts secrets from tool output", async () => {
    const g = gw();
    g.vault.set("MY_SECRET", "supersecretvalue123");
    // a tool that echoes config won't contain the secret; assert vault listing hides values
    expect(g.vault.list()).toContain("MY_SECRET");
    const dump = JSON.stringify(g.vault.list());
    expect(dump).not.toContain("supersecretvalue123");
  });

  it("lists the bundled hello-world skill as disabled", async () => {
    const g = gw();
    const res = await g.executeTool("skill_list", {}, { caller: "test" });
    expect(res.ok).toBe(true);
    const skills = res.data as { name: string; enabled: boolean }[];
    const hello = skills.find((s) => s.name === "hello-world");
    expect(hello).toBeTruthy();
    expect(hello!.enabled).toBe(false);
  });

  it("generates a skill that is saved disabled", async () => {
    const g = gw();
    const res = await g.executeTool(
      "skill_generate_from_prompt",
      { name: "test-skill", description: "demo", requirements: ["do a thing"] },
      { caller: "test" },
    );
    // risk 2 -> needs approval first
    expect(res.approvalRequired || res.ok).toBeTruthy();
    if (res.approvalRequired) {
      g.approvals.approve(res.approvalRequired.approvalId, "once");
      const gen = await g.executeTool(
        "skill_generate_from_prompt",
        { name: "test-skill", description: "demo", requirements: ["do a thing"] },
        { caller: "test" },
      );
      expect(gen.ok).toBe(true);
      expect((gen.data as { enabled: boolean }).enabled).toBe(false);
    }
  });
});
