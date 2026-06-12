import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { commandExists, execFileSafe } from "../util/exec.js";
import type { Gateway } from "../gateway.js";

/**
 * Computer Use: screenshot + mouse + keyboard control of the local desktop.
 *
 * macOS-only for now. Screenshots use the built-in `screencapture` / `sips`
 * binaries (requires Screen Recording permission for the process running
 * LocalAnt). Mouse/keyboard input uses `cliclick` (`brew install cliclick`,
 * requires Accessibility permission).
 *
 * Coordinate system: screenshots are resampled to the display's logical
 * (point) resolution, so a pixel in the returned image maps 1:1 to the x,y
 * coordinates accepted by the click/move/drag tools.
 */

/** Special keys accepted by `cliclick kp:`. */
export const SPECIAL_KEYS = new Set([
  "arrow-down", "arrow-left", "arrow-right", "arrow-up",
  "delete", "end", "enter", "esc", "fwd-delete", "home",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8",
  "f9", "f10", "f11", "f12", "f13", "f14", "f15", "f16",
  "mute", "page-down", "page-up", "return", "space", "tab",
  "volume-down", "volume-up",
]);

/** Friendly aliases → cliclick key names. */
const KEY_ALIASES: Record<string, string> = {
  up: "arrow-up",
  down: "arrow-down",
  left: "arrow-left",
  right: "arrow-right",
  escape: "esc",
  backspace: "delete",
  pagedown: "page-down",
  pageup: "page-up",
  del: "fwd-delete",
};

export const MODIFIERS = ["cmd", "shift", "alt", "ctrl", "fn"] as const;
export type Modifier = (typeof MODIFIERS)[number];

/**
 * Build the cliclick argv for a key press with optional modifiers.
 * Single printable characters are typed (`t:`); named keys use `kp:`.
 */
export function buildKeyComboArgs(key: string, modifiers: readonly Modifier[] = []): string[] {
  const normalized = KEY_ALIASES[key.toLowerCase()] ?? key.toLowerCase();
  let press: string;
  if (SPECIAL_KEYS.has(normalized)) {
    press = `kp:${normalized}`;
  } else if ([...key].length === 1) {
    press = `t:${key}`;
  } else {
    throw new Error(
      `Unknown key "${key}". Use a single character or one of: ${[...SPECIAL_KEYS].join(", ")} ` +
        `(aliases: ${Object.keys(KEY_ALIASES).join(", ")}).`,
    );
  }
  if (modifiers.length === 0) return [press];
  const mods = modifiers.join(",");
  return [`kd:${mods}`, press, `ku:${mods}`];
}

/**
 * Build the cliclick argv to type free text. cliclick's `t:` does not emit
 * newlines, so each line is typed and separated with `kp:return`.
 */
export function buildTypeArgs(text: string): string[] {
  const lines = text.split("\n");
  const args: string[] = [];
  lines.forEach((line, idx) => {
    if (line.length > 0) args.push(`t:${line}`);
    if (idx < lines.length - 1) args.push("kp:return");
  });
  return args;
}

function ensureMacos(): void {
  if (process.platform !== "darwin") {
    throw new Error("Computer Use tools are currently macOS-only.");
  }
}

async function cliclick(args: string[]): Promise<string> {
  ensureMacos();
  if (!(await commandExists("cliclick"))) {
    throw new Error(
      "cliclick not found on PATH. Enable desktop control with `localant deps install desktop` " +
        "(or manually: `brew install cliclick`), then grant Accessibility permission " +
        "(System Settings → Privacy & Security → Accessibility) to the app running LocalAnt.",
    );
  }
  const res = await execFileSafe("cliclick", args, { timeoutMs: 30_000 });
  if (res.code !== 0) {
    throw new Error(
      `cliclick ${args.join(" ")} failed: ${res.stderr || res.stdout}. ` +
        "If input has no effect, grant Accessibility permission to the app running LocalAnt.",
    );
  }
  return res.stdout.trim();
}

async function osascript(script: string): Promise<string> {
  const res = await execFileSafe("osascript", ["-e", script], { timeoutMs: 15_000 });
  if (res.code !== 0) throw new Error(`osascript failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

/** Logical (point) size of the main display, e.g. { width: 1512, height: 982 }. */
async function mainDisplayPointSize(): Promise<{ width: number; height: number }> {
  const out = await osascript('tell application "Finder" to get bounds of window of desktop');
  const parts = out.split(",").map((s) => Number.parseInt(s.trim(), 10));
  const [p0, p1, p2, p3] = parts;
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n)) || p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
    throw new Error(`Could not parse display bounds: "${out}"`);
  }
  return { width: p2 - p0, height: p3 - p1 };
}

async function imagePixelSize(file: string): Promise<{ width: number; height: number }> {
  const res = await execFileSafe("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeoutMs: 15_000 });
  const w = /pixelWidth:\s*(\d+)/.exec(res.stdout);
  const h = /pixelHeight:\s*(\d+)/.exec(res.stdout);
  if (!w || !h) throw new Error(`Could not read image size of ${file}: ${res.stderr || res.stdout}`);
  const wVal = w[1];
  const hVal = h[1];
  if (!wVal || !hVal) throw new Error(`Could not read image size of ${file}: ${res.stderr || res.stdout}`);
  return { width: Number.parseInt(wVal, 10), height: Number.parseInt(hVal, 10) };
}

const point = z.object({ x: z.number().int().min(0), y: z.number().int().min(0) });

export function registerComputerTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "computer_screenshot",
    description:
      "Capture a screenshot of the main display. Returns the image (resampled to logical resolution, " +
      "so image pixels map 1:1 to computer_* click coordinates) plus the saved file path. " +
      "macOS-only; requires Screen Recording permission.",
    risk: 1,
    inputSchema: z.object({
      format: z.enum(["png", "jpg"]).default("png"),
    }).strip(),
    summarize: () => "screenshot of main display",
    handler: async (i) => {
      ensureMacos();
      const file = path.join(gw.paths.workspaceDir, `screen-${Date.now()}.${i.format}`);
      const cap = await execFileSafe("screencapture", ["-x", "-t", i.format, file], { timeoutMs: 30_000 });
      if (cap.code !== 0 || !fs.existsSync(file)) {
        throw new Error(
          `screencapture failed: ${cap.stderr || cap.stdout || "no output"}. ` +
            "Grant Screen Recording permission (System Settings → Privacy & Security → Screen Recording) " +
            "to the app running LocalAnt, then retry.",
        );
      }
      const logical = await mainDisplayPointSize();
      const px = await imagePixelSize(file);
      if (px.width !== logical.width) {
        const rs = await execFileSafe(
          "sips",
          ["--resampleHeightWidth", String(logical.height), String(logical.width), file],
          { timeoutMs: 30_000 },
        );
        if (rs.code !== 0) throw new Error(`sips resample failed: ${rs.stderr || rs.stdout}`);
      }
      const base64 = fs.readFileSync(file).toString("base64");
      return {
        path: file,
        width: logical.width,
        height: logical.height,
        note: "Coordinates in this image map 1:1 to computer_* tool x,y inputs.",
        __image: { mimeType: i.format === "jpg" ? "image/jpeg" : "image/png", base64 },
      };
    },
  });

  r.register({
    name: "computer_screen_info",
    description: "Get the logical resolution of the main display (the coordinate space for computer_* tools).",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      ensureMacos();
      return await mainDisplayPointSize();
    },
  });

  r.register({
    name: "computer_cursor_position",
    description: "Get the current mouse cursor position.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      const out = await cliclick(["p"]);
      const m = /(\d+),(\d+)/.exec(out);
      if (!m) throw new Error(`Could not parse cursor position: "${out}"`);
      const m1 = m[1];
      const m2 = m[2];
      if (!m1 || !m2) throw new Error(`Could not parse cursor position: "${out}"`);
      return { x: Number.parseInt(m1, 10), y: Number.parseInt(m2, 10) };
    },
  });

  r.register({
    name: "computer_list_apps",
    description: "List visible running applications and the frontmost app.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      ensureMacos();
      const visible = await osascript(
        'tell application "System Events" to get name of every application process whose visible is true',
      );
      const frontmost = await osascript(
        'tell application "System Events" to get name of first application process whose frontmost is true',
      );
      return { frontmost, visible: visible.split(",").map((s) => s.trim()).filter(Boolean) };
    },
  });

  r.register({
    name: "computer_open_app",
    description: "Open (or bring to front) an application by name, e.g. 'Notes'. Risk 2.",
    risk: 2,
    inputSchema: z.object({ name: z.string().min(1) }).strip(),
    summarize: (i) => `open app ${i.name}`,
    handler: async (i) => {
      ensureMacos();
      const res = await execFileSafe("open", ["-a", i.name], { timeoutMs: 15_000 });
      if (res.code !== 0) throw new Error(`Could not open "${i.name}": ${res.stderr || res.stdout}`);
      return { opened: i.name };
    },
  });

  r.register({
    name: "computer_move_mouse",
    description: "Move the mouse cursor to x,y (screenshot coordinates) without clicking.",
    risk: 1,
    inputSchema: point.strip(),
    summarize: (i) => `move mouse to ${i.x},${i.y}`,
    handler: async (i) => ({ output: await cliclick([`m:${i.x},${i.y}`]) }),
  });

  r.register({
    name: "computer_left_click",
    description: "Left-click at x,y (screenshot coordinates). Requires approval (risk 3).",
    risk: 3,
    inputSchema: point.strip(),
    summarize: (i) => `left click at ${i.x},${i.y}`,
    handler: async (i) => ({ output: await cliclick([`c:${i.x},${i.y}`]) }),
  });

  r.register({
    name: "computer_double_click",
    description: "Double-click at x,y (screenshot coordinates). Requires approval (risk 3).",
    risk: 3,
    inputSchema: point.strip(),
    summarize: (i) => `double click at ${i.x},${i.y}`,
    handler: async (i) => ({ output: await cliclick([`dc:${i.x},${i.y}`]) }),
  });

  r.register({
    name: "computer_right_click",
    description: "Right-click at x,y (screenshot coordinates). Requires approval (risk 3).",
    risk: 3,
    inputSchema: point.strip(),
    summarize: (i) => `right click at ${i.x},${i.y}`,
    handler: async (i) => ({ output: await cliclick([`rc:${i.x},${i.y}`]) }),
  });

  r.register({
    name: "computer_drag",
    description: "Drag from x1,y1 to x2,y2 (screenshot coordinates). Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({
      x1: z.number().int().min(0), y1: z.number().int().min(0),
      x2: z.number().int().min(0), y2: z.number().int().min(0),
    }).strip(),
    summarize: (i) => `drag ${i.x1},${i.y1} → ${i.x2},${i.y2}`,
    handler: async (i) => ({ output: await cliclick([`dd:${i.x1},${i.y1}`, `du:${i.x2},${i.y2}`]) }),
  });

  r.register({
    name: "computer_type",
    description: "Type text at the current focus (newlines become Return presses). Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({ text: z.string().min(1).max(5000) }).strip(),
    summarize: (i) => `type ${i.text.length} chars`,
    handler: async (i) => {
      const args = buildTypeArgs(i.text);
      if (args.length === 0) return { typed: 0 };
      await cliclick(args);
      return { typed: i.text.length };
    },
  });

  r.register({
    name: "computer_paste_text",
    description:
      "Put text on the clipboard and paste it with Cmd+V (faster and more reliable than computer_type " +
      "for long text). Overwrites the clipboard. Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({ text: z.string().min(1).max(100_000) }).strip(),
    summarize: (i) => `paste ${i.text.length} chars`,
    handler: async (i) => {
      ensureMacos();
      const res = await execFileSafe("pbcopy", [], { timeoutMs: 10_000, input: i.text });
      if (res.code !== 0) throw new Error(`pbcopy failed: ${res.stderr || res.stdout}`);
      await cliclick(["kd:cmd", "t:v", "ku:cmd"]);
      return { pasted: i.text.length };
    },
  });

  r.register({
    name: "computer_key",
    description:
      "Press a key, optionally with modifiers. Examples: {key:'return'}, {key:'tab'}, " +
      "{key:'c', modifiers:['cmd']} for Cmd+C. Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({
      key: z.string().min(1),
      modifiers: z.array(z.enum(MODIFIERS)).default([]),
      repeat: z.number().int().min(1).max(50).default(1),
    }).strip(),
    summarize: (i) => `key ${[...i.modifiers, i.key].join("+")}${i.repeat > 1 ? ` ×${i.repeat}` : ""}`,
    handler: async (i) => {
      const combo = buildKeyComboArgs(i.key, i.modifiers);
      const args = Array.from({ length: i.repeat }, () => combo).flat();
      await cliclick(args);
      return { pressed: [...i.modifiers, i.key].join("+"), repeat: i.repeat };
    },
  });

  r.register({
    name: "computer_scroll",
    description:
      "Scroll the focused element by sending Page Up/Down key presses (click the target area first " +
      "to focus it). Requires approval (risk 3).",
    risk: 3,
    inputSchema: z.object({
      direction: z.enum(["up", "down"]),
      amount: z.number().int().min(1).max(10).default(1),
    }).strip(),
    summarize: (i) => `scroll ${i.direction} ×${i.amount}`,
    handler: async (i) => {
      const keyArg = i.direction === "up" ? "kp:page-up" : "kp:page-down";
      await cliclick(Array.from({ length: i.amount }, () => keyArg));
      return { scrolled: i.direction, amount: i.amount };
    },
  });
}
