import { describe, it, expect } from "vitest";
import { redact, redactDeep, truncate } from "@localant/shared";

describe("redact", () => {
  it("scrubs known secret values", () => {
    expect(redact("token is hunter2supersecret", ["hunter2supersecret"])).not.toContain("hunter2supersecret");
  });

  it("ignores very short known secrets to avoid over-redaction", () => {
    expect(redact("the cat sat", ["cat"])).toContain("cat");
  });

  it("redacts OpenAI-style keys", () => {
    expect(redact("key sk-abcdefghijklmnopqrstuvwx")).toContain("«redacted»");
  });

  it("redacts GitHub PATs", () => {
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz12")).toContain("«redacted»");
  });

  it("redacts AWS access key ids", () => {
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toContain("«redacted»");
  });

  it("keeps the Authorization header prefix but redacts the token", () => {
    const out = redact("Authorization: Bearer abc.def.ghi");
    expect(out).toMatch(/Authorization: Bearer «redacted»/i);
  });

  it("leaves ordinary text untouched", () => {
    expect(redact("hello world")).toBe("hello world");
  });
});

describe("redactDeep", () => {
  it("recurses into nested objects and arrays", () => {
    const input = { a: ["ghp_abcdefghijklmnopqrstuvwxyz12"], b: { c: "ok" } };
    const out = redactDeep(input);
    expect(out.a[0]).toContain("«redacted»");
    expect(out.b.c).toBe("ok");
  });

  it("leaves non-string primitives unchanged", () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(true)).toBe(true);
    expect(redactDeep(null)).toBe(null);
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  it("truncates and annotates long strings", () => {
    const out = truncate("a".repeat(50), 10);
    expect(out).toMatch(/truncated 40 chars/);
  });
});
