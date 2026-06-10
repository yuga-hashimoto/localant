import { describe, it, expect } from "vitest";
import { CommandGuard, parseCommand } from "@chatgpt-local-app/gateway";

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

  it("rejects rm -rf regardless of spacing", () => {
    expect(() => guard().assertAllowed("rm    -rf   /tmp/x")).toThrow();
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
