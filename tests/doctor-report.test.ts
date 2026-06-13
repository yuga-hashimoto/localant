import { describe, it, expect } from "vitest";
import { collectDoctor } from "@localant/cli";

/** The --json surface for `localant doctor` is built from collectDoctor(); this
 * pins its shape so scripts consuming the JSON keep working. */
describe("collectDoctor", () => {
  it("returns a structured report with required-check status", async () => {
    const report = await collectDoctor();
    expect(report).toHaveProperty("ok");
    expect(typeof report.ok).toBe("boolean");
    expect(report.platform).toBe(process.platform);
    expect(report.node).toBe(process.version);
    expect(Array.isArray(report.checks)).toBe(true);
    expect(Array.isArray(report.optionalDeps)).toBe(true);
    // node + git are required checks and present in the test runner.
    const node = report.checks.find((c) => c.name.startsWith("Node.js"));
    expect(node?.required).toBe(true);
  });

  it("ok reflects whether every required check passed", async () => {
    const report = await collectDoctor();
    const allRequiredPass = report.checks.every((c) => !c.required || c.pass);
    expect(report.ok).toBe(allRequiredPass);
  });
});
