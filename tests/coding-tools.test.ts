import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createGateway } from "@localant/gateway";

let base: string;
let proj: string;

function gw(profile: "minimal" | "coding" | "full" = "full", mode: "strict" | "open" | "yolo" = "open") {
  const g = createGateway(base);
  g.saveConfig({
    ...g.config(),
    tools: { profile },
    security: { ...g.config().security, mode, allowedDirectories: [base] },
  });
  return g;
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-coding-"));
  proj = path.join(base, "proj");
  fs.mkdirSync(proj, { recursive: true });
});
// maxRetries/retryDelay absorb the Windows EBUSY race where a just-stopped
// background shell still holds a handle to the temp dir during cleanup.
afterEach(async () => {
  if (process.platform === "win32") await new Promise((resolve) => setTimeout(resolve, 500));
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

describe("bash tool", () => {
  it("executes an allowed command", async () => {
    const g = gw();
    const res = await g.executeTool("bash", { command: "echo hello-localant", cwd: proj }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect((res.data as { stdout: string }).stdout).toContain("hello-localant");
  });

  it("rejects sudo / rm -rf / dd", async () => {
    const g = gw();
    for (const command of ["sudo ls", "rm -rf /tmp/x", "dd if=/dev/zero of=/dev/sda"]) {
      const res = await g.executeTool("bash", { command, cwd: proj }, { caller: "test" });
      expect(res.ok, command).toBe(false);
      expect(res.error, command).toMatch(/blocked|rejected/i);
    }
  });

  it("respects cwd PathGuard (blocklisted path rejected)", async () => {
    const g = gw();
    // ~/.ssh is in the sensitive blocklist on every platform (unlike /etc, which
    // doesn't exist on Windows).
    const blocked = path.join(os.homedir(), ".ssh");
    const res = await g.executeTool("bash", { command: "ls", cwd: blocked }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/blocklist|allowed/i);
  });

  it("records an audit entry for bash", async () => {
    const g = gw();
    await g.executeTool("bash", { command: "echo audited", cwd: proj }, { caller: "test" });
    expect(g.audit.list(10).some((l) => l.tool === "bash")).toBe(true);
  });

  it("requires approval for bash in strict mode", async () => {
    const g = gw("full", "strict");
    const res = await g.executeTool("bash", { command: "echo hi", cwd: proj }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.approvalRequired).toBeTruthy();
  });

  it("blocks core tokens even in yolo mode", async () => {
    const g = gw("full", "yolo");
    const res = await g.executeTool("bash", { command: "sudo rm -rf /", cwd: proj }, { caller: "test" });
    expect(res.ok).toBe(false);
  });
});

describe("background shell", () => {
  it("starts, reads output, and stops a process", async () => {
    const g = gw();
    const start = await g.executeTool("shell_run_background", { command: "node -e \"console.log(42)\"", cwd: proj }, { caller: "test" });
    expect(start.ok).toBe(true);
    const id = (start.data as { processId: string }).processId;
    await new Promise((r) => setTimeout(r, 300));
    const out = await g.executeTool("shell_get_output", { processId: id }, { caller: "test" });
    expect(out.ok).toBe(true);
    const stop = await g.executeTool("shell_stop", { processId: id }, { caller: "test" });
    expect(stop.ok).toBe(true);
  });

  it("interprets && chaining through the shell", async () => {
    const g = gw();
    const start = await g.executeTool(
      "shell_run_background",
      { command: "echo one && echo two", cwd: proj },
      { caller: "test" },
    );
    expect(start.ok).toBe(true);
    const id = (start.data as { processId: string }).processId;
    await new Promise((r) => setTimeout(r, 300));
    const out = await g.executeTool("shell_get_output", { processId: id }, { caller: "test" });
    expect(out.ok).toBe(true);
    const stdout = (out.data as { stdout: string }).stdout;
    expect(stdout).toContain("one");
    expect(stdout).toContain("two");
  });
});

describe("editing tools", () => {
  it("read/write aliases work", async () => {
    const g = gw();
    const f = path.join(proj, "a.txt");
    const w = await g.executeTool("write", { path: f, content: "v1", overwrite: false }, { caller: "test" });
    expect(w.ok).toBe(true);
    const r = await g.executeTool("read", { path: f }, { caller: "test" });
    expect((r.data as { content: string }).content).toBe("v1");
  });

  it("edit replaces oldString -> newString", async () => {
    const g = gw();
    const f = path.join(proj, "b.txt");
    fs.writeFileSync(f, "hello world");
    const res = await g.executeTool("edit", { path: f, oldString: "world", newString: "localant" }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe("hello localant");
    expect((res.data as { backupId: string }).backupId).toBeTruthy();
  });

  it("edit fails when oldString is missing", async () => {
    const g = gw();
    const f = path.join(proj, "c.txt");
    fs.writeFileSync(f, "abc");
    const res = await g.executeTool("edit", { path: f, oldString: "zzz", newString: "x" }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it("edit fails on multiple matches unless replaceAll", async () => {
    const g = gw();
    const f = path.join(proj, "d.txt");
    fs.writeFileSync(f, "x x x");
    const fail = await g.executeTool("edit", { path: f, oldString: "x", newString: "y" }, { caller: "test" });
    expect(fail.ok).toBe(false);
    const ok = await g.executeTool("edit", { path: f, oldString: "x", newString: "y", replaceAll: true }, { caller: "test" });
    expect(ok.ok).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe("y y y");
  });

  it("multi_edit applies atomically", async () => {
    const g = gw();
    const f = path.join(proj, "e.txt");
    fs.writeFileSync(f, "one two");
    const res = await g.executeTool(
      "multi_edit",
      { path: f, edits: [{ oldString: "one", newString: "1" }, { oldString: "two", newString: "2" }] },
      { caller: "test" },
    );
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe("1 2");
  });

  it("multi_edit leaves file untouched when one edit fails", async () => {
    const g = gw();
    const f = path.join(proj, "f.txt");
    fs.writeFileSync(f, "alpha");
    const res = await g.executeTool(
      "multi_edit",
      { path: f, edits: [{ oldString: "alpha", newString: "beta" }, { oldString: "missing", newString: "x" }] },
      { caller: "test" },
    );
    expect(res.ok).toBe(false);
    expect(fs.readFileSync(f, "utf8")).toBe("alpha");
  });

  it("grep supports regex, case-insensitive and context", async () => {
    const g = gw();
    fs.writeFileSync(path.join(proj, "g.ts"), "line1\nFOObar\nline3");
    const res = await g.executeTool(
      "grep",
      { path: proj, query: "foo.", regex: true, caseInsensitive: true, contextBefore: 1 },
      { caller: "test" },
    );
    expect(res.ok).toBe(true);
    const matches = (res.data as { matches: { text: string }[] }).matches;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.text).toContain("FOObar");
  });

  it("glob ignores node_modules/.git/dist", async () => {
    const g = gw();
    fs.mkdirSync(path.join(proj, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(proj, "node_modules", "pkg", "x.ts"), "");
    fs.writeFileSync(path.join(proj, "real.ts"), "");
    const res = await g.executeTool("glob", { path: proj, pattern: "**/*.ts" }, { caller: "test" });
    const matches = (res.data as { matches: string[] }).matches;
    expect(matches.some((m) => m.endsWith("real.ts"))).toBe(true);
    expect(matches.some((m) => m.includes("node_modules"))).toBe(false);
  });
});

describe("git tools", () => {
  function initRepo(dir: string) {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t.dev"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  }

  it("git_add stages files", async () => {
    const g = gw();
    initRepo(proj);
    fs.writeFileSync(path.join(proj, "x.txt"), "hi");
    const res = await g.executeTool("git_add", { repo: proj, paths: [] }, { caller: "test" });
    expect(res.ok).toBe(true);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: proj }).toString();
    expect(status).toContain("A  x.txt");
  });

  it("git_reset --hard requires risk-4 approval", async () => {
    const g = gw();
    initRepo(proj);
    const res = await g.executeTool("git_reset_hard", { repo: proj, ref: "HEAD" }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.approvalRequired).toBeTruthy();
    expect(res.approvalRequired!.risk).toBe(4);
  });

  it("apply_patch rejects paths outside the allowlist (traversal)", async () => {
    const g = gw("full", "strict");
    initRepo(proj);
    const patch = `--- a/../escape.txt\n+++ b/../escape.txt\n@@ -0,0 +1 @@\n+pwned\n`;
    const res = await g.executeTool("apply_patch", { cwd: proj, patch }, { caller: "test" });
    expect(res.ok).toBe(false);
  });
});

describe("project validation", () => {
  it("project_get_package_scripts reads scripts", async () => {
    const g = gw();
    fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ scripts: { test: "echo ok" } }));
    const res = await g.executeTool("project_get_package_scripts", { path: proj }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect((res.data as { scripts: Record<string, string> }).scripts.test).toBe("echo ok");
  });

  it("project_run_validation runs the configured/validate/test script", async () => {
    const g = gw();
    fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ scripts: { validate: "echo VALIDATED" } }));
    fs.writeFileSync(path.join(proj, "package-lock.json"), "{}");
    const res = await g.executeTool("project_run_validation", { path: proj }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.data)).toContain("VALIDATED");
  });
});

describe("agent / compatibility surface", () => {
  it("keeps retired per-agent tool names as deprecated compatibility wrappers", async () => {
    const g = gw("full", "yolo");
    for (const name of [
      "agent_run",
      "agent_list",
      "agent_plan",
      "coding_agent_list",
      "coding_agent_start_task",
      "coding_agent_continue_task",
      "openclaw_status",
      "desktop_commander_status",
    ]) {
      const tool = g.registry.get(name);
      expect(tool).toBeDefined();
      expect(tool!.description).toMatch(/Deprecated compatibility wrapper/i);
    }

    const res = await g.executeTool("agent_list", {}, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("registers the high-level autopilot tool with no provider/agent argument", () => {
    const g = gw();
    const tool = g.registry.get("autopilot");
    expect(tool).toBeDefined();
    const shape = (tool!.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(["constraints", "cwd", "mode", "task", "timeoutMs"]);
    expect(tool!.description.toLowerCase()).not.toMatch(/claude|codex|opencode|openclaw|hermes|agy|antigravity/);
  });

  it("does not register ChatGPT-duplicate tools (todo/question/webfetch/websearch)", async () => {
    const g = gw();
    for (const name of ["todowrite", "todo_list", "question", "ask_user", "webfetch", "websearch", "web_open"]) {
      expect(g.registry.get(name)).toBeUndefined();
    }
  });

  it("still exposes approval_request (local security gating)", async () => {
    const g = gw();
    const res = await g.executeTool("approval_request", { action: "do risky thing", risk: 3 }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect((res.data as { approvalId: string }).approvalId).toBeTruthy();
  });
});

describe("lsp", () => {
  it("lsp_document_symbols lists declarations in a TS file", async () => {
    const g = gw();
    const f = path.join(proj, "sym.ts");
    fs.writeFileSync(f, "export function alpha() {}\nexport const beta = 1;\nclass Gamma {}\n");
    const res = await g.executeTool("lsp_document_symbols", { path: f }, { caller: "test" });
    expect(res.ok).toBe(true);
    const data = res.data as { name: string }[] | { error: string };
    // typescript is available in the dev environment; if not, guidance is returned.
    if (Array.isArray(data)) {
      const names = data.map((s) => s.name);
      expect(names).toContain("alpha");
      expect(names).toContain("Gamma");
    } else {
      expect(data.error).toMatch(/typescript/i);
    }
  });

  it("lsp_status reports tool availability", async () => {
    const g = gw();
    const res = await g.executeTool("lsp_status", {}, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty("typescript");
  });
});

describe("coding agent sessions & repo lock", () => {
  // A fake "agent" that just sleeps, so the task stays in `running` while we
  // assert lock / session behavior. The task prompt is appended as a trailing
  // arg that node ignores.
  function gwWithFakeAgent() {
    const g = createGateway(base);
    g.saveConfig({
      ...g.config(),
      tools: { profile: "full" },
      security: { ...g.config().security, mode: "yolo", allowedDirectories: [base] },
      codingAgents: {
        ...g.config().codingAgents,
        fake: {
          enabled: true,
          command: "node",
          args: [],
          planArgs: [],
          executeArgs: ["-e", "setTimeout(() => {}, 60000)"],
          dangerArgs: [],
          defaultPermissionMode: "execute",
          maxTurns: 1,
          timeoutMs: 600_000,
        },
      },
    });
    return g;
  }

  it("rejects a second task on the same repo and frees the lock on stop", async () => {
    const g = gwWithFakeAgent();
    const first = await g.agents.startTask("fake", proj, "task one", { createBranch: false, sessionId: "chat-a" });
    expect(first.taskId).toBeTruthy();

    // Same working tree, different chat → blocked by the repo lock.
    await expect(
      g.agents.startTask("fake", proj, "task two", { createBranch: false, sessionId: "chat-b" }),
    ).rejects.toThrow(/already running in this repo/i);

    // Stopping the first releases the lock so a new task can start.
    await g.agents.stopTask(first.taskId);
    const third = await g.agents.startTask("fake", proj, "task three", { createBranch: false, sessionId: "chat-b" });
    expect(third.taskId).toBeTruthy();
    await g.agents.stopTask(third.taskId);
  });

  it("does not append dangerArgs while planning, even in yolo mode", async () => {
    const g = createGateway(base);
    const script = path.join(base, "plan-agent.cjs");
    const out = path.join(base, "plan-args.json");
    fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`);
    g.saveConfig({
      ...g.config(),
      tools: { profile: "full" },
      security: { ...g.config().security, mode: "yolo", allowedDirectories: [base] },
      codingAgents: {
        ...g.config().codingAgents,
        fake: {
          enabled: true,
          command: "node",
          args: [script],
          planArgs: ["--plan"],
          executeArgs: ["--execute"],
          dangerArgs: ["--danger"],
          defaultPermissionMode: "plan",
          maxTurns: 1,
          timeoutMs: 60_000,
        },
      },
    });

    await g.agents.plan("fake", proj, "make a plan");
    const args = JSON.parse(fs.readFileSync(out, "utf8")) as string[];
    expect(args).toContain("--plan");
    expect(args).not.toContain("--danger");
  });

  it("guards validation commands with PathGuard and CommandGuard", async () => {
    const g = gw("full", "strict");
    await expect(g.agents.runValidation(proj, "not-allowlisted --version")).rejects.toThrow(/not in the allowed command list/i);
    await expect(g.agents.runValidation(path.join(os.homedir(), ".ssh"), "pnpm test")).rejects.toThrow(
      /blocklist|allowed/i,
    );
  });

  it("filters listTasks by session but shows all when unfiltered", async () => {
    const g = gwWithFakeAgent();
    const projB = path.join(base, "projB");
    fs.mkdirSync(projB, { recursive: true });

    const a = await g.agents.startTask("fake", proj, "a", { createBranch: false, sessionId: "chat-a" });
    const b = await g.agents.startTask("fake", projB, "b", { createBranch: false, sessionId: "chat-b" });

    const onlyA = g.agents.listTasks("chat-a");
    expect(onlyA.map((t) => t.id)).toEqual([a.taskId]);
    expect(onlyA[0]!.sessionId).toBe("chat-a");

    const all = g.agents.listTasks();
    expect(all.map((t) => t.id).sort()).toEqual([a.taskId, b.taskId].sort());

    await g.agents.stopTask(a.taskId);
    await g.agents.stopTask(b.taskId);
  });
});

describe("fs backup roundtrip", () => {
  it("restores a backup by the id returned from fs_list_backups", async () => {
    const g = gw();
    const f = path.join(proj, "doc.txt");
    fs.writeFileSync(f, "original");

    const made = await g.executeTool("fs_backup_file", { path: f }, { caller: "test" });
    expect(made.ok).toBe(true);
    const backupId = (made.data as { id: string }).id;
    expect(backupId).toBeTruthy();

    // Mutate the file after the backup was taken.
    fs.writeFileSync(f, "changed");

    const listed = await g.executeTool("fs_list_backups", {}, { caller: "test" });
    expect(listed.ok).toBe(true);
    const ids = (listed.data as { id: string }[]).map((b) => b.id);
    expect(ids).toContain(backupId);

    // Restoring the id surfaced by fs_list_backups must succeed and revert content.
    const restored = await g.executeTool("fs_restore_backup", { id: backupId }, { caller: "test" });
    expect(restored.ok).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe("original");
  });
});

describe("audit redaction", () => {
  it("redacts secret values from bash output", async () => {
    const g = gw();
    g.vault.set("MY_TOKEN", "supersecret-bash-value");
    const res = await g.executeTool("bash", { command: "echo supersecret-bash-value", cwd: proj }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.data)).not.toContain("supersecret-bash-value");
    expect(JSON.stringify(g.audit.list(5))).not.toContain("supersecret-bash-value");
  });
});
