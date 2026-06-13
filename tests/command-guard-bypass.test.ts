import { describe, it, expect } from "vitest";
import { CommandGuard } from "@localant/gateway";
import { DEFAULT_ALLOWED_COMMANDS, BLOCKED_COMMAND_TOKENS } from "@localant/shared";

/**
 * Adversarial bypass vectors for CommandGuard. These pin the *current* defense
 * surface so a future refactor can't silently weaken it. They assert behavior
 * only — no guard logic is changed here. (See command-guard.test.ts for the
 * baseline accept/reject cases.)
 */
function guard(mode: "strict" | "open" | "yolo") {
  const g = new CommandGuard([...DEFAULT_ALLOWED_COMMANDS], [...BLOCKED_COMMAND_TOKENS]);
  g.setMode(mode);
  return g;
}

describe("CommandGuard bypass vectors — chaining & redirection (assertAllowed)", () => {
  const open = guard("open");
  const vectors = [
    "ls; rm foo",
    "ls && cat x",
    "ls || cat x",
    "ls | grep x",
    "ls & cat x",
    "ls > out.txt",
    "cat < in.txt",
  ];
  for (const v of vectors) {
    it(`rejects "${v}"`, () => {
      expect(() => open.assertAllowed(v)).toThrow(/pipelines, redirection and chaining/);
    });
  }
});

describe("CommandGuard bypass vectors — command/process substitution (assertAllowed)", () => {
  const open = guard("open");
  const vectors = ["ls $(whoami)", "ls `whoami`", "echo ${HOME}", "cat <(ls)", "tee >(cat)"];
  for (const v of vectors) {
    it(`rejects "${v}"`, () => {
      expect(() => open.assertAllowed(v)).toThrow(/substitution/);
    });
  }
});

describe("CommandGuard bypass vectors — destructive rm under obfuscation", () => {
  const open = guard("open");
  it("rejects rm -rf with collapsed extra whitespace", () => {
    expect(() => open.assertAllowed("rm    -rf    /tmp/x")).toThrow(/recursive\/forced 'rm'/);
  });
  it("rejects rm with tab-separated flags (normalized to spaces)", () => {
    expect(() => open.assertAllowed("rm\t-rf\t/tmp/x")).toThrow(/recursive\/forced 'rm'/);
  });
  it("rejects reversed flag order rm -fr", () => {
    expect(() => open.assertAllowed("rm -fr /tmp/x")).toThrow(/recursive\/forced 'rm'/);
  });
  it("rejects long-form --force and --recursive", () => {
    expect(() => open.assertAllowed("rm --recursive --force /tmp/x")).toThrow(/recursive\/forced 'rm'/);
  });
  it("rejects chmod 777 with extra whitespace", () => {
    expect(() => open.assertAllowed("chmod   777 /etc")).toThrow(/chmod 777/);
  });
});

describe("CommandGuard bypass vectors — blocked tokens are case-insensitive & position-independent", () => {
  const open = guard("open");
  it("blocks an uppercased blocked token", () => {
    expect(() => open.assertAllowed("SUDO ls")).toThrow(/blocked command/);
  });
  it("blocks a blocked token regardless of leading allowed prefix tokens", () => {
    // chaining is rejected first; the point is the dangerous token never slips through.
    expect(() => open.assertAllowed("ls && sudo rm")).toThrow();
  });
  for (const tok of ["dd", "mkfs", "fdisk", "diskutil", "shutdown", "reboot"]) {
    it(`blocks "${tok}" as a bare command`, () => {
      expect(() => open.assertAllowed(`${tok} arg`)).toThrow(/blocked command/);
    });
  }
});

describe("CommandGuard bypass vectors — yolo still enforces the hard blocklist", () => {
  const yolo = guard("yolo");
  it("allows an arbitrary non-allowlisted command", () => {
    expect(yolo.assertAllowed("make build")).toBe("make build");
  });
  it("still blocks sudo in yolo", () => {
    expect(() => yolo.assertAllowed("sudo reboot")).toThrow(/blocked command/);
  });
  it("still blocks rm -rf in yolo", () => {
    expect(() => yolo.assertAllowed("rm -rf /")).toThrow(/recursive\/forced 'rm'/);
  });
});

describe("CommandGuard.assertNotBlocked — post-approval hard floor", () => {
  const g = guard("open");
  it("permits an approved arbitrary command", () => {
    expect(g.assertNotBlocked("make deploy")).toBe("make deploy");
  });
  it("still blocks a hard-blocklisted token after approval", () => {
    expect(() => g.assertNotBlocked("sudo make deploy")).toThrow(/blocked command even after approval/);
  });
  it("still blocks rm -rf and rm -fr after approval", () => {
    expect(() => g.assertNotBlocked("rm -rf /data")).toThrow(/blocked even after approval/);
    expect(() => g.assertNotBlocked("rm -fr /data")).toThrow(/blocked even after approval/);
  });
});
