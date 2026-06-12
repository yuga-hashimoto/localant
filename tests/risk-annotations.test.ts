import { describe, it, expect } from "vitest";
import { toolAnnotationsForRisk, type RiskLevel } from "@localant/shared";

describe("toolAnnotationsForRisk (risk-based, non-yolo)", () => {
  it("marks risk-0 tools as read-only and idempotent", () => {
    expect(toolAnnotationsForRisk(0)).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("marks risk-1 (safe write draft) as non-read-only and non-destructive", () => {
    expect(toolAnnotationsForRisk(1)).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("marks file-modifying tools (risk 2) as destructive but closed-world", () => {
    const a = toolAnnotationsForRisk(2);
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(true);
    expect(a.openWorldHint).toBe(false);
  });

  it("marks shell/network/agent and destructive tools (risk 3-4) as open-world + destructive", () => {
    for (const risk of [3, 4] as RiskLevel[]) {
      const a = toolAnnotationsForRisk(risk);
      expect(a.readOnlyHint).toBe(false);
      expect(a.destructiveHint).toBe(true);
      expect(a.openWorldHint).toBe(true);
    }
  });

  it("never marks a non-read-only tool as read-only (no false safe hints)", () => {
    for (const risk of [1, 2, 3, 4] as RiskLevel[]) {
      expect(toolAnnotationsForRisk(risk, "open").readOnlyHint).toBe(false);
    }
  });

  it("keeps risk-based hints in strict and open modes", () => {
    for (const mode of ["strict", "open"] as const) {
      expect(toolAnnotationsForRisk(0, mode).readOnlyHint).toBe(true);
      expect(toolAnnotationsForRisk(4, mode).readOnlyHint).toBe(false);
      expect(toolAnnotationsForRisk(4, mode).destructiveHint).toBe(true);
    }
  });
});

describe("toolAnnotationsForRisk (yolo)", () => {
  it("keeps actual risk hints instead of advertising higher-risk tools as read-only", () => {
    expect(toolAnnotationsForRisk(0, "yolo").readOnlyHint).toBe(true);
    for (const risk of [3, 4] as RiskLevel[]) {
      const a = toolAnnotationsForRisk(risk, "yolo");
      expect(a.readOnlyHint).toBe(false);
      expect(a.destructiveHint).toBe(true);
      expect(a.openWorldHint).toBe(true);
    }
  });
});
