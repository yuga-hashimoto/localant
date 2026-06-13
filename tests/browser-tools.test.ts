import { describe, expect, it } from "vitest";
import { normalizePlaywrightModule } from "../packages/gateway/src/tools/browser.js";

const launcher = async () => ({ newPage: async () => ({}), close: async () => undefined });

describe("browser tools", () => {
  it("normalizes an ESM-shaped Playwright import", () => {
    const runtime = normalizePlaywrightModule({ chromium: { launch: launcher } });
    expect(runtime.chromium.launch).toBe(launcher);
  });

  it("normalizes a CommonJS-shaped Playwright dynamic import", () => {
    const runtime = normalizePlaywrightModule({ default: { chromium: { launch: launcher } } });
    expect(runtime.chromium.launch).toBe(launcher);
  });

  it("throws a helpful error when Chromium launcher cannot be found", () => {
    expect(() => normalizePlaywrightModule({ default: {} })).toThrow(/Chromium launcher/i);
  });
});
