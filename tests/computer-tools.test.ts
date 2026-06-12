import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createGateway, buildKeyComboArgs, buildTypeArgs, SPECIAL_KEYS } from "@localant/gateway";
import { isToolInProfile } from "@localant/shared";

let base: string;

function gw(mode: "strict" | "open" | "yolo" = "yolo") {
  const g = createGateway(base);
  g.saveConfig({
    ...g.config(),
    tools: { profile: "full" },
    security: { ...g.config().security, mode, allowedDirectories: [base] },
  });
  return g;
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-computer-"));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("buildKeyComboArgs", () => {
  it("maps special keys to kp:", () => {
    expect(buildKeyComboArgs("return")).toEqual(["kp:return"]);
    expect(buildKeyComboArgs("page-down")).toEqual(["kp:page-down"]);
  });

  it("resolves friendly aliases", () => {
    expect(buildKeyComboArgs("up")).toEqual(["kp:arrow-up"]);
    expect(buildKeyComboArgs("escape")).toEqual(["kp:esc"]);
    expect(buildKeyComboArgs("backspace")).toEqual(["kp:delete"]);
  });

  it("types single characters via t:", () => {
    expect(buildKeyComboArgs("a")).toEqual(["t:a"]);
  });

  it("wraps presses with kd:/ku: when modifiers given", () => {
    expect(buildKeyComboArgs("c", ["cmd"])).toEqual(["kd:cmd", "t:c", "ku:cmd"]);
    expect(buildKeyComboArgs("tab", ["cmd", "shift"])).toEqual(["kd:cmd,shift", "kp:tab", "ku:cmd,shift"]);
  });

  it("rejects unknown multi-character keys", () => {
    expect(() => buildKeyComboArgs("not-a-key")).toThrow(/Unknown key/);
  });

  it("every advertised special key round-trips", () => {
    for (const key of SPECIAL_KEYS) {
      expect(buildKeyComboArgs(key)).toEqual([`kp:${key}`]);
    }
  });
});

describe("buildTypeArgs", () => {
  it("types plain text as one t: argument", () => {
    expect(buildTypeArgs("hello world")).toEqual(["t:hello world"]);
  });

  it("converts newlines into kp:return", () => {
    expect(buildTypeArgs("a\nb")).toEqual(["t:a", "kp:return", "t:b"]);
  });

  it("handles consecutive and trailing newlines", () => {
    expect(buildTypeArgs("a\n\nb\n")).toEqual(["t:a", "kp:return", "kp:return", "t:b", "kp:return"]);
  });
});

describe("computer tool registration", () => {
  const expected: Array<[string, number]> = [
    ["computer_screenshot", 1],
    ["computer_screen_info", 0],
    ["computer_cursor_position", 0],
    ["computer_list_apps", 0],
    ["computer_open_app", 2],
    ["computer_move_mouse", 1],
    ["computer_left_click", 3],
    ["computer_double_click", 3],
    ["computer_right_click", 3],
    ["computer_drag", 3],
    ["computer_type", 3],
    ["computer_paste_text", 3],
    ["computer_key", 3],
    ["computer_scroll", 3],
  ];

  it("registers every computer tool with the expected risk", () => {
    const g = gw();
    for (const [name, risk] of expected) {
      const def = g.registry.get(name);
      expect(def, name).toBeDefined();
      expect(def?.risk, name).toBe(risk);
    }
  });

  it("is excluded from the minimal and coding profiles", () => {
    for (const [name] of expected) {
      expect(isToolInProfile(name, "minimal"), name).toBe(false);
      expect(isToolInProfile(name, "coding"), name).toBe(false);
      expect(isToolInProfile(name, "full"), name).toBe(true);
    }
  });

  it("rejects invalid input before touching the system", async () => {
    const g = gw();
    const res = await g.executeTool("computer_left_click", { x: -5, y: 10 }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid input/);
  });

  it("rejects unknown keys in computer_key", async () => {
    const g = gw();
    const res = await g.executeTool("computer_key", { key: "bogus-key" }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Unknown key/);
  });

  it("requires approval for clicks in strict mode", async () => {
    const g = gw("strict");
    const res = await g.executeTool("computer_left_click", { x: 1, y: 1 }, { caller: "test" });
    expect(res.ok).toBe(false);
    expect(res.approvalRequired).toBeDefined();
  });
});
