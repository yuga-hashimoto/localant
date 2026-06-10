import { describe, it, expect } from "vitest";
import { CommandGuard, parseCommand } from "@localant/gateway";

const allowed = ["pwd", "ls", "git status", "git diff", "pnpm test"];
const blocked = ["sudo", "su", "rm", "dd", "mkfs", "chown", "ssh", "shutdown"];

function guard() {
  return new CommandGuard(allowed, blocked);
}

describe("CommandGuard.assertAllowed", () => {
  it("accepts an exact allowlisted command", () => {
    expect(guard().assertAllowed("pwd")).toBe("pwd");
  });

  it("accepts an allowlisted prefix with args", () => {
    expect(guard().assertAllowed("git status --short")).toBe("git status --short");
  });

  it("rejects a command not on the allowlist", () => {
    expect(() => guard().assertAllowed("cat /etc/passwd")).toThrow(/not in the allowed/);
  });

  it("rejects command chaining bypass (&&)", () => {
    expect(() => guard().assertAllowed("pwd && rm -rf /")).toThrow(/chaining|blocked/i);
  });

  it("rejects pipes", () => {
    expect(() => guard().assertAllowed("ls | sh")).toThrow(/pipelines|blocked/i);
  });

  it("rejects command substitution", () => {
    expect(() => guard().assertAllowed("ls $(whoami)")).toThrow(/substitution/i);
  });

  it("rejects backtick substitution", () => {
    expect(() => guard().assertAllowed("ls `whoami`")).toThrow(/substitution/i);
  });

  it("rejects blocked token even if prefixed by allowed", () => {
    expect(() => guard().assertAllowed("pwd; sudo reboot")).toThrow();
  });

  it("accepts a non-allowlisted command when mode is yolo", () => {
    const g = guard();
    g.setMode("yolo");
    expect(g.assertAllowed("cat /etc/passwd")).toBe("cat /etc/passwd");
  });

  it("still rejects blocked tokens when mode is yolo", () => {
    const g = guard();
    g.setMode("yolo");
    expect(() => g.assertAllowed("sudo reboot")).toThrow(/blocked/);
  });

  it("accepts a non-allowlisted command when mode is open", () => {
    const g = guard();
    g.setMode("open");
    expect(g.assertAllowed("cat /etc/hosts")).toBe("cat /etc/hosts");
  });

  it("still rejects blocked tokens when mode is open", () => {
    const g = guard();
    g.setMode("open");
    expect(() => g.assertAllowed("sudo reboot")).toThrow(/blocked/);
  });

  it("still rejects rm -rf when mode is open", () => {
    const g = guard();
    g.setMode("open");
    expect(() => g.assertAllowed("rm -rf /tmp/x")).toThrow(/rm/);
  });
});

describe("CommandGuard.assertNotBlocked", () => {
  it("allows an approved non-allowlisted command", () => {
    expect(guard().assertNotBlocked("cat README.md")).toBe("cat README.md");
  });
  it("still blocks the hard blocklist", () => {
    expect(() => guard().assertNotBlocked("sudo rm -rf /")).toThrow();
  });
  it("still blocks rm -rf", () => {
    expect(() => guard().assertNotBlocked("rm -rf node_modules")).toThrow();
  });
});

describe("parseCommand", () => {
  it("tokenizes across operators", () => {
    expect(parseCommand("a && b | c").tokens).toEqual(["a", "b", "c"]);
  });
});
