import { describe, it, expect } from "vitest";
import { parseServeoBanner } from "../packages/cli/src/serveo-setup.js";

const SUB = "localant-80525feb4bcd51d0c8571865ecc27379";

describe("parseServeoBanner", () => {
  it("returns null until the forwarding line arrives", () => {
    expect(parseServeoBanner("Pseudo-terminal will not be allocated", SUB)).toBeNull();
  });

  it("detects a registered key (fixed subdomain granted)", () => {
    const out = `Forwarding HTTP traffic from https://${SUB}.serveousercontent.com\n`;
    const v = parseServeoBanner(out, SUB);
    expect(v).not.toBeNull();
    expect(v?.registered).toBe(true);
    expect(v?.url).toBe(`https://${SUB}.serveousercontent.com`);
    expect(v?.consoleUrl).toBeUndefined();
  });

  it("detects an unregistered key and surfaces the console URL", () => {
    const out = [
      "To request a particular subdomain, you first need to register your SSH public key.",
      "To register, visit one the addresses below to login with your Google or GitHub account.",
      "https://console.serveo.net/ssh/keys?add=SHA256%3AWJDlq1hG3f%2Fv%2BZRbuQWBSPpnXLOtdFl7tHSjKDeCNFU",
      "Forwarding HTTP traffic from https://3bf8838019b3c8f4-60-91-33-174.serveousercontent.com",
    ].join("\n");
    const v = parseServeoBanner(out, SUB);
    expect(v).not.toBeNull();
    expect(v?.registered).toBe(false);
    expect(v?.consoleUrl).toBe(
      "https://console.serveo.net/ssh/keys?add=SHA256%3AWJDlq1hG3f%2Fv%2BZRbuQWBSPpnXLOtdFl7tHSjKDeCNFU",
    );
  });

  it("treats a non-matching forwarding host as unregistered even without the notice", () => {
    const out = "Forwarding HTTP traffic from https://random-other-host.serveousercontent.com\n";
    const v = parseServeoBanner(out, SUB);
    expect(v?.registered).toBe(false);
  });
});
