import { describe, it, expect } from "vitest";
import { assembleAgentArgs } from "@localant/gateway";
import { ConfigSchema } from "@localant/shared";

/**
 * Guards the per-agent non-interactive invocation. Each CLI exposes a different
 * "run one prompt and exit" entry point; passing the prompt as a bare
 * positional broke hermes / openclaw (prompt was read as a subcommand) and
 * codex (interactive mode without a TTY). These tests pin the assembled argv so
 * a regression in the defaults is caught without spawning the real binaries.
 */
describe("assembleAgentArgs", () => {
  it("appends the prompt when no placeholder is present", () => {
    expect(assembleAgentArgs(["-p"], "do the thing")).toEqual(["-p", "do the thing"]);
  });

  it("substitutes every {{prompt}} occurrence instead of appending", () => {
    expect(assembleAgentArgs(["-z", "{{prompt}}", "chat"], "hi")).toEqual(["-z", "hi", "chat"]);
  });

  it("substitutes a placeholder embedded inside a token", () => {
    expect(assembleAgentArgs(["--task={{prompt}}"], "x")).toEqual(["--task=x"]);
  });

  it("handles an empty base list", () => {
    expect(assembleAgentArgs([], "only")).toEqual(["only"]);
  });
});

/** Build the argv the manager would for a given agent + stage, mirroring
 * `[...args, ...stageArgs]` then prompt assembly. */
function argvFor(agent: string, stage: "planArgs" | "executeArgs" | "resumeArgs", prompt: string): string[] {
  const cfg = ConfigSchema.parse({}).codingAgents[agent];
  if (!cfg) throw new Error(`no such agent ${agent}`);
  return assembleAgentArgs([...cfg.args, ...cfg[stage]], prompt);
}

describe("default coding-agent invocations", () => {
  const P = "PROMPT";

  it("claude-code runs `claude -p <prompt>`", () => {
    expect(argvFor("claude-code", "executeArgs", P)).toEqual(["-p", P]);
  });

  it("antigravity-cli runs `agy --print <prompt>`", () => {
    expect(argvFor("antigravity-cli", "executeArgs", P)).toEqual(["--print", P]);
  });

  it("codex runs `codex exec <prompt>` outside a trusted repo", () => {
    expect(argvFor("codex", "executeArgs", P)).toEqual(["exec", "--skip-git-repo-check", P]);
  });

  it("opencode runs `opencode run <prompt>`", () => {
    expect(argvFor("opencode", "executeArgs", P)).toEqual(["run", P]);
  });

  it("hermes runs `hermes chat -q <prompt>` (not a bare subcommand)", () => {
    expect(argvFor("hermes-agent", "executeArgs", P)).toEqual(["chat", "-q", P]);
  });

  it("openclaw runs `openclaw agent --local --session-id <id> -m <prompt>`", () => {
    // The `agent` subcommand refuses to run without a session selector, so an
    // explicit --session-id is required for the non-interactive turn.
    expect(argvFor("openclaw", "executeArgs", P)).toEqual([
      "agent",
      "--local",
      "--session-id",
      "localant-exec",
      "-m",
      P,
    ]);
  });

  it("command-code runs `cmd -p <prompt>`", () => {
    expect(argvFor("command-code", "executeArgs", P)).toEqual(["-p", P]);
  });
});

describe("resume invocations for turn-based dialogue", () => {
  const P = "FOLLOWUP";

  it("claude-code resumes with -c", () => {
    expect(argvFor("claude-code", "resumeArgs", P)).toEqual(["-p", "-c", P]);
  });

  it("codex resumes the most recent session", () => {
    expect(argvFor("codex", "resumeArgs", P)).toEqual(["exec", "resume", "--last", "--skip-git-repo-check", P]);
  });

  it("hermes resumes with --continue", () => {
    expect(argvFor("hermes-agent", "resumeArgs", P)).toEqual(["chat", "--continue", "-q", P]);
  });

  it("antigravity-cli resumes with -c BEFORE --print", () => {
    // agy's --print consumes the next token as the prompt, so -c must precede it
    // or it would be read as the prompt value (and the prompt dropped).
    expect(argvFor("antigravity-cli", "resumeArgs", P)).toEqual(["-c", "--print", P]);
  });

  it("command-code resumes with -c", () => {
    expect(argvFor("command-code", "resumeArgs", P)).toEqual(["-p", "-c", P]);
  });

  it("every agent defines resumeArgs", () => {
    const cfgs = ConfigSchema.parse({}).codingAgents;
    for (const [agent, cfg] of Object.entries(cfgs)) {
      expect(cfg.resumeArgs.length, `${agent} should define resumeArgs`).toBeGreaterThan(0);
    }
  });
});

/**
 * In yolo mode the manager appends dangerArgs AFTER the stage args:
 * `[...args, ...stageArgs, ...dangerArgs]` then prompt assembly. For agents
 * whose prompt flag consumes the next token (agy's --print, hermes' -q), a
 * trailing danger flag would otherwise be swallowed as the prompt value (or
 * trigger an argparse error). The {{prompt}} placeholder must pin the prompt
 * immediately after that flag, leaving the danger flag to trail harmlessly.
 */
describe("yolo-mode assembly keeps the prompt anchored to its flag", () => {
  const P = "PROMPT";

  function yoloArgv(agent: string, stage: "planArgs" | "executeArgs" | "resumeArgs"): string[] {
    const cfg = ConfigSchema.parse({}).codingAgents[agent];
    if (!cfg) throw new Error(`no such agent ${agent}`);
    return assembleAgentArgs([...cfg.args, ...cfg[stage], ...cfg.dangerArgs], P);
  }

  it("antigravity-cli keeps the prompt right after --print, danger flag trailing", () => {
    expect(yoloArgv("antigravity-cli", "executeArgs")).toEqual([
      "--print",
      P,
      "--dangerously-skip-permissions",
    ]);
    expect(yoloArgv("antigravity-cli", "resumeArgs")).toEqual([
      "-c",
      "--print",
      P,
      "--dangerously-skip-permissions",
    ]);
  });

  it("hermes keeps the prompt right after -q, --yolo trailing", () => {
    expect(yoloArgv("hermes-agent", "executeArgs")).toEqual(["chat", "-q", P, "--yolo"]);
    expect(yoloArgv("hermes-agent", "resumeArgs")).toEqual([
      "chat",
      "--continue",
      "-q",
      P,
      "--yolo",
    ]);
  });
});
