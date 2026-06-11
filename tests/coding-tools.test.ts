import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
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
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

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
    const res = await g.executeTool("bash", { command: "ls", cwd: "/etc" }, { caller: "test" });
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
    const res = await g.executeTool("project_get_package_scripts", { projectId: proj }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect((res.data as { scripts: Record<string, string> }).scripts.test).toBe("echo ok");
  });

  it("project_run_validation runs the configured/validate/test script", async () => {
    const g = gw();
    fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ scripts: { validate: "echo VALIDATED" } }));
    fs.writeFileSync(path.join(proj, "package-lock.json"), "{}");
    const res = await g.executeTool("project_run_validation", { projectId: proj }, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res.data)).toContain("VALIDATED");
  });
});

describe("todo / question / agent", () => {
  it("todowrite persists and todo_list returns them", async () => {
    const g = gw();
    const w = await g.executeTool("todowrite", { todos: [{ content: "do thing", status: "pending" }] }, { caller: "test" });
    expect(w.ok).toBe(true);
    const list = await g.executeTool("todo_list", {}, { caller: "test" });
    expect((list.data as { todos: { content: string }[] }).todos[0]!.content).toBe("do thing");
  });

  it("question creates a pending question", async () => {
    const g = gw();
    const res = await g.executeTool("question", { question: "proceed?" }, { caller: "test" });
    expect(res.ok).toBe(true);
    const id = (res.data as { questionId: string }).questionId;
    expect(g.todos.getQuestion(id)!.status).toBe("pending");
  });

  it("agent_list alias resolves to coding_agent_list", async () => {
    const g = gw();
    const res = await g.executeTool("agent_list", {}, { caller: "test" });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
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

describe("web aliases", () => {
  it("web_open is registered as an alias of browser_open", async () => {
    const g = gw();
    expect(g.registry.get("web_open")).toBeTruthy();
    expect(g.registry.get("web_extract_text")).toBeTruthy();
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
