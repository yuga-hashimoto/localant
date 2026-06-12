import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tailscaleEnv } from "@localant/gateway";

describe("tailscaleEnv", () => {
  const original = process.env.SHLVL;

  afterEach(() => {
    if (original === undefined) delete process.env.SHLVL;
    else process.env.SHLVL = original;
  });

  it("injects SHLVL=1 when it is absent (launchd context)", () => {
    delete process.env.SHLVL;
    expect(tailscaleEnv().SHLVL).toBe("1");
  });

  it("injects SHLVL=1 when it is present but empty", () => {
    process.env.SHLVL = "";
    expect(tailscaleEnv().SHLVL).toBe("1");
  });

  it("preserves an existing non-empty SHLVL (interactive shell)", () => {
    process.env.SHLVL = "3";
    expect(tailscaleEnv().SHLVL).toBe("3");
  });

  it("does not mutate process.env when injecting", () => {
    delete process.env.SHLVL;
    const result = tailscaleEnv();
    expect(result.SHLVL).toBe("1");
    expect(process.env.SHLVL).toBeUndefined();
  });
});
