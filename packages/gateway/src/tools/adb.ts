import path from "node:path";
import { z } from "zod";
import { commandExists, execFileSafe } from "../util/exec.js";
import type { Gateway } from "../gateway.js";

async function adb(args: string[], serial?: string): Promise<string> {
  if (!(await commandExists("adb"))) {
    throw new Error("adb not found on PATH. Install Android platform-tools to use ADB tools.");
  }
  const full = serial ? ["-s", serial, ...args] : args;
  const res = await execFileSafe("adb", full, { timeoutMs: 60_000, maxOutputBytes: 200_000 });
  if (res.code !== 0) throw new Error(`adb ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

const dev = z.object({ serial: z.string().optional() });

export function registerAdbTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({ name: "adb_list_devices", description: "List connected Android devices.", risk: 0, inputSchema: z.object({}).strip(), handler: async () => ({ output: await adb(["devices", "-l"]) }) });
  r.register({ name: "adb_get_current_activity", description: "Get the foreground activity.", risk: 0, inputSchema: dev, handler: async (i) => ({ output: await adb(["shell", "dumpsys", "activity", "activities"], i.serial) }) });
  r.register({
    name: "adb_screenshot",
    description: "Capture a screenshot to the device and report the path.",
    risk: 1,
    inputSchema: dev,
    handler: async (i) => {
      await adb(["shell", "screencap", "-p", "/sdcard/cla_screen.png"], i.serial);
      return { devicePath: "/sdcard/cla_screen.png", note: "Use adb_pull_screenshot to fetch it." };
    },
  });
  r.register({
    name: "adb_pull_screenshot",
    description: "Pull the captured screenshot into the workspace directory.",
    risk: 1,
    inputSchema: dev,
    handler: async (i) => {
      const dest = path.join(gw.paths.workspaceDir, `adb-${Date.now()}.png`);
      await adb(["pull", "/sdcard/cla_screen.png", dest], i.serial);
      return { localPath: dest };
    },
  });
  r.register({ name: "adb_tap", description: "Tap at x,y.", risk: 3, inputSchema: dev.extend({ x: z.number().int(), y: z.number().int() }), summarize: (i) => `adb tap ${i.x},${i.y}`, handler: async (i) => ({ output: await adb(["shell", "input", "tap", String(i.x), String(i.y)], i.serial) }) });
  r.register({ name: "adb_swipe", description: "Swipe between coordinates.", risk: 3, inputSchema: dev.extend({ x1: z.number().int(), y1: z.number().int(), x2: z.number().int(), y2: z.number().int(), ms: z.number().int().default(300) }), summarize: () => "adb swipe", handler: async (i) => ({ output: await adb(["shell", "input", "swipe", String(i.x1), String(i.y1), String(i.x2), String(i.y2), String(i.ms)], i.serial) }) });
  r.register({ name: "adb_input_text", description: "Type text on the device (audited).", risk: 3, inputSchema: dev.extend({ text: z.string() }), summarize: () => "adb input text", handler: async (i) => ({ output: await adb(["shell", "input", "text", i.text.replace(/ /g, "%s")], i.serial) }) });
  r.register({ name: "adb_keyevent", description: "Send a key event (e.g. 4 = BACK).", risk: 3, inputSchema: dev.extend({ keycode: z.number().int() }), summarize: (i) => `adb keyevent ${i.keycode}`, handler: async (i) => ({ output: await adb(["shell", "input", "keyevent", String(i.keycode)], i.serial) }) });
  r.register({ name: "adb_logcat", description: "Dump recent logcat output.", risk: 1, inputSchema: dev.extend({ lines: z.number().int().min(1).max(2000).default(200) }), handler: async (i) => ({ output: await adb(["logcat", "-d", "-t", String(i.lines)], i.serial) }) });
  r.register({ name: "adb_clear_logcat", description: "Clear the logcat buffer.", risk: 2, inputSchema: dev, summarize: () => "adb logcat -c", handler: async (i) => ({ output: await adb(["logcat", "-c"], i.serial) }) });
  r.register({ name: "adb_start_app", description: "Start an app by package/activity.", risk: 3, inputSchema: dev.extend({ component: z.string() }), summarize: (i) => `adb start ${i.component}`, handler: async (i) => ({ output: await adb(["shell", "am", "start", "-n", i.component], i.serial) }) });
  r.register({ name: "adb_stop_app", description: "Force-stop an app by package.", risk: 3, inputSchema: dev.extend({ pkg: z.string() }), summarize: (i) => `adb stop ${i.pkg}`, handler: async (i) => ({ output: await adb(["shell", "am", "force-stop", i.pkg], i.serial) }) });
  r.register({
    name: "adb_install_apk",
    description: "Install an APK (path must be inside an allowed directory). Requires approval (risk 3).",
    risk: 3,
    inputSchema: dev.extend({ apkPath: z.string() }),
    summarize: (i) => `adb install ${i.apkPath}`,
    handler: async (i) => {
      const resolved = gw.pathGuard.assertAccess(i.apkPath, "read");
      return { output: await adb(["install", "-r", resolved], i.serial) };
    },
  });
}
