import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, type Config } from "@localant/shared";
import {
  AutopilotEngine,
  ProviderRegistry,
  PathGuard,
  resolveProviderOrder,
  shouldFallback,
  looksRateLimited,
  looksCommandNotFound,
  looksAuthError,
  createGateway,
  type AutopilotProvider,
  type AutopilotProviderInput,
  type AutopilotProviderResult,
} from "@localant/gateway";

/** A config with custom autopilot settings, all defaults otherwise. */
function configWith(autopilot: Partial<Config["autopilot"]>): Config {
  const base = ConfigSchema.parse({});
  return { ...base, autopilot: { ...base.autopilot, ...autopilot } };
}

// ---------------------------------------------------------------------------

describe("resolveProviderOrder", () => {
  it("puts primary first, then fallbacks in order", () => {
    const cfg = configWith({ primary: "claude-code", fallbacks: ["codex", "opencode"] });
    expect(resolveProviderOrder(cfg)).toEqual(["claude-code", "codex", "opencode"]);
  });

  it("drops the primary if it also appears in fallbacks (no duplicates)", () => {
    const cfg = configWith({ primary: "codex", fallbacks: ["codex", "opencode"] });
    expect(resolveProviderOrder(cfg)).toEqual(["codex", "opencode"]);
  });

  it("skips providers disabled in settings", () => {
    const cfg = configWith({
      primary: "claude-code",
      fallbacks: ["codex", "opencode"],
      providers: { codex: { enabled: false } },
    });
    expect(resolveProviderOrder(cfg)).toEqual(["claude-code", "opencode"]);
  });

  it("skips unknown provider ids (not a configured agent)", () => {
    const cfg = configWith({ primary: "nope", fallbacks: ["codex"] });
    expect(resolveProviderOrder(cfg)).toEqual(["codex"]);
  });

  it("returns empty when the primary and all fallbacks are disabled", () => {
    const cfg = configWith({
      primary: "claude-code",
      fallbacks: [],
      providers: { "claude-code": { enabled: false } },
    });
    expect(resolveProviderOrder(cfg)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("fallbackPolicy", () => {
  const policy = ConfigSchema.parse({}).autopilot.fallbackPolicy;

  it("falls back on operational failures by default", () => {
    for (const reason of ["timeout", "non_zero_exit", "empty_output", "no_changes", "rate_limit", "command_not_found", "auth_error"] as const) {
      expect(shouldFallback(policy, reason), reason).toBe(true);
    }
  });

  it("does NOT fall back on safety_block or approval_required by default", () => {
    expect(shouldFallback(policy, "safety_block")).toBe(false);
    expect(shouldFallback(policy, "approval_required")).toBe(false);
  });

  it("honors a custom policy that disables non_zero_exit fallback", () => {
    const custom = ConfigSchema.parse({ autopilot: { fallbackPolicy: { onNonZeroExit: false } } }).autopilot.fallbackPolicy;
    expect(shouldFallback(custom, "non_zero_exit")).toBe(false);
    expect(shouldFallback(custom, "timeout")).toBe(true);
  });

  it("classifies rate-limit and command-not-found output heuristically", () => {
    expect(looksRateLimited("Error: 429 rate limit exceeded")).toBe(true);
    expect(looksRateLimited("usage limit reached for today")).toBe(true);
    expect(looksRateLimited("normal completion")).toBe(false);
    expect(looksCommandNotFound("spawn claude ENOENT")).toBe(true);
    expect(looksCommandNotFound("command not found: codex")).toBe(true);
    expect(looksCommandNotFound("all good")).toBe(false);
  });

  it("detects auth/config errors that CLIs print while still exiting 0", () => {
    // Real signatures captured from claude, codex and openclaw runs.
    expect(looksAuthError("Not logged in · Please run /login")).toBe(true);
    expect(looksAuthError('error="invalid_token", Missing Authorization header')).toBe(true);
    expect(looksAuthError("Unsupported service_tier: flex")).toBe(true);
    expect(looksAuthError("OAuth token refresh failed: invalid_grant")).toBe(true);
    expect(looksAuthError("Here is the implementation plan: …")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/** Build a stub provider that records its invocations. */
function stubProvider(
  id: string,
  opts: { available?: boolean; result?: Partial<AutopilotProviderResult> },
): { provider: AutopilotProvider; calls: AutopilotProviderInput[] } {
  const calls: AutopilotProviderInput[] = [];
  const provider: AutopilotProvider = {
    id,
    label: id,
    supportedModes: ["plan", "execute", "review", "fix", "pr"],
    available: async () => ({ available: opts.available ?? true, enabled: true }),
    run: async (input) => {
      calls.push(input);
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        diff: "",
        changed: false,
        durationMs: 1,
        failureReason: "non_zero_exit",
        ...opts.result,
      };
    },
  };
  return { provider, calls };
}

function stubRegistry(map: Record<string, AutopilotProvider>): ProviderRegistry {
  return {
    get: (id: string) => map[id],
    list: () => Object.values(map),
  } as unknown as ProviderRegistry;
}

function openPathGuard(dir: string): PathGuard {
  const pg = new PathGuard([dir]);
  pg.setMode("open");
  return pg;
}

describe("AutopilotEngine fallback chain", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-ap-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns the primary's result without trying fallbacks when it succeeds", async () => {
    const primary = stubProvider("claude-code", { result: { ok: true, exitCode: 0, stdout: "done", failureReason: undefined } });
    const fb = stubProvider("codex", {});
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: ["codex"] }),
      stubRegistry({ "claude-code": primary.provider, codex: fb.provider }),
      openPathGuard(dir),
    );
    const res = await engine.run({ task: "do it", cwd: dir, mode: "plan" });
    expect(res.ok).toBe(true);
    expect(res.attempts.map((a) => a.providerId)).toEqual(["claude-code"]);
    expect(fb.calls).toHaveLength(0);
  });

  it("advances to the next provider in order when the primary fails (policy permits)", async () => {
    const primary = stubProvider("claude-code", { result: { failureReason: "non_zero_exit" } });
    const fb = stubProvider("codex", { result: { ok: true, exitCode: 0, stdout: "fixed", failureReason: undefined } });
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: ["codex"] }),
      stubRegistry({ "claude-code": primary.provider, codex: fb.provider }),
      openPathGuard(dir),
    );
    const res = await engine.run({ task: "do it", cwd: dir, mode: "execute" });
    expect(res.ok).toBe(true);
    expect(res.attempts.map((a) => a.providerId)).toEqual(["claude-code", "codex"]);
  });

  it("stops without falling back when the policy refuses the failure reason", async () => {
    const primary = stubProvider("claude-code", { result: { failureReason: "non_zero_exit" } });
    const fb = stubProvider("codex", {});
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: ["codex"], fallbackPolicy: { onNonZeroExit: false } as Config["autopilot"]["fallbackPolicy"] }),
      stubRegistry({ "claude-code": primary.provider, codex: fb.provider }),
      openPathGuard(dir),
    );
    const res = await engine.run({ task: "do it", cwd: dir, mode: "execute" });
    expect(res.ok).toBe(false);
    expect(res.stoppedReason).toBe("non_zero_exit");
    expect(fb.calls).toHaveLength(0);
  });

  it("passes the prior failure + diff to the next provider as continuation context", async () => {
    const primary = stubProvider("claude-code", { result: { failureReason: "non_zero_exit", changed: true, diff: "diff --git a b", branch: "cla/x" } });
    const fb = stubProvider("codex", { result: { ok: true, exitCode: 0, stdout: "ok", failureReason: undefined } });
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: ["codex"] }),
      stubRegistry({ "claude-code": primary.provider, codex: fb.provider }),
      openPathGuard(dir),
    );
    await engine.run({ task: "do it", cwd: dir, mode: "execute" });
    expect(fb.calls).toHaveLength(1);
    expect(fb.calls[0].priorContext?.providerId).toBe("claude-code");
    expect(fb.calls[0].priorContext?.failureReason).toBe("non_zero_exit");
    expect(fb.calls[0].priorContext?.diff).toContain("diff --git");
    // The fallback continues on the prior branch rather than creating a new one.
    expect(fb.calls[0].createBranch).toBe(false);
    expect(fb.calls[0].branchName).toBe("cla/x");
  });

  it("keeps each failed attempt's stdout/stderr so the cause is inspectable", async () => {
    const primary = stubProvider("claude-code", {
      result: { failureReason: "non_zero_exit", stdout: "planning…", stderr: "boom: missing API key" },
    });
    const fb = stubProvider("codex", { result: { ok: true, exitCode: 0, stdout: "answer", failureReason: undefined } });
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: ["codex"] }),
      stubRegistry({ "claude-code": primary.provider, codex: fb.provider }),
      openPathGuard(dir),
    );
    const res = await engine.run({ task: "do it", cwd: dir, mode: "plan" });
    const failed = res.attempts.find((a) => a.providerId === "claude-code");
    expect(failed?.ok).toBe(false);
    expect(failed?.stdout).toBe("planning…");
    expect(failed?.stderr).toBe("boom: missing API key");
  });

  it("marks the run exhausted when every provider fails", async () => {
    const primary = stubProvider("claude-code", { result: { failureReason: "timeout" } });
    const fb = stubProvider("codex", { result: { failureReason: "timeout" } });
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: ["codex"] }),
      stubRegistry({ "claude-code": primary.provider, codex: fb.provider }),
      openPathGuard(dir),
    );
    const res = await engine.run({ task: "do it", cwd: dir, mode: "execute" });
    expect(res.ok).toBe(false);
    expect(res.exhausted).toBe(true);
    expect(res.attempts).toHaveLength(2);
  });

  it("releases the cwd lock after a completed run", async () => {
    const primary = stubProvider("claude-code", { result: { ok: true, exitCode: 0, stdout: "done", failureReason: undefined } });
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: [] }),
      stubRegistry({ "claude-code": primary.provider }),
      openPathGuard(dir),
    );
    const first = await engine.run({ task: "first", cwd: dir, mode: "review" });
    const second = await engine.run({ task: "second", cwd: dir, mode: "plan" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(engine.activeRuns()).toHaveLength(0);
  });

  it("throws when no provider is enabled", async () => {
    const engine = new AutopilotEngine(
      () => configWith({ primary: "claude-code", fallbacks: [], providers: { "claude-code": { enabled: false } } }),
      stubRegistry({}),
      openPathGuard(dir),
    );
    await expect(engine.run({ task: "x", cwd: dir, mode: "plan" })).rejects.toThrow(/no automation provider/i);
  });
});

// ---------------------------------------------------------------------------

describe("ProviderRegistry + settings persistence", () => {
  let base: string;
  beforeEach(() => {
    fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
    base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-apreg-"));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it("builds one provider per configured coding agent", () => {
    const gw = createGateway(base);
    const ids = gw.providers.list().map((p) => p.id);
    for (const id of ["claude-code", "codex", "opencode", "openclaw", "antigravity-cli", "hermes-agent", "command-code"]) {
      expect(ids, `missing ${id}`).toContain(id);
    }
    expect(gw.providers.get("does-not-exist")).toBeUndefined();
    expect(gw.providers.get("codex")?.label).toBe("Codex");
  });

  it("persists Autopilot Settings across reloads", () => {
    const gw = createGateway(base);
    gw.saveConfig({
      ...gw.config(),
      autopilot: {
        ...gw.config().autopilot,
        primary: "codex",
        fallbacks: ["opencode", "claude-code"],
        providers: { openclaw: { enabled: false } },
      },
    });
    // A fresh gateway over the same config dir must see the saved settings.
    const reopened = createGateway(base);
    expect(reopened.config().autopilot.primary).toBe("codex");
    expect(reopened.config().autopilot.fallbacks).toEqual(["opencode", "claude-code"]);
    expect(resolveProviderOrder(reopened.config())).toEqual(["codex", "opencode", "claude-code"]);
    expect(reopened.config().autopilot.providers.openclaw.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("autopilot tool + localant_doctor", () => {
  let base: string;
  beforeEach(() => {
    fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
    base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-apdoc-"));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it("autopilot follows saved settings (no provider/agent argument in its schema)", async () => {
    const gw = createGateway(base);
    const tool = gw.registry.get("autopilot");
    expect(tool).toBeDefined();
    const shape = (tool!.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape).not.toHaveProperty("agent");
    expect(shape).not.toHaveProperty("provider");
    expect(shape).toHaveProperty("task");
    expect(shape).toHaveProperty("mode");
  });

  it("localant_doctor reports the autopilot settings and provider availability", async () => {
    const gw = createGateway(base);
    gw.saveConfig({
      ...gw.config(),
      tools: { profile: "minimal" },
      autopilot: { ...gw.config().autopilot, primary: "codex", fallbacks: ["opencode"] },
    });
    const res = await gw.executeTool("localant_doctor", {}, { caller: "test" });
    expect(res.ok).toBe(true);
    const data = res.data as {
      autopilot: { primary: string; order: string[]; providers: { id: string; label: string }[] };
      tools: { profile: string };
      recent: { errors: unknown[]; blocks: unknown[]; timeouts: unknown[] };
    };
    expect(data.autopilot.primary).toBe("codex");
    expect(data.autopilot.order).toEqual(["codex", "opencode"]);
    expect(data.autopilot.providers.map((p) => p.id)).toContain("claude-code");
    expect(data.tools.profile).toBe("minimal");
    expect(Array.isArray(data.recent.errors)).toBe(true);
  });
});
