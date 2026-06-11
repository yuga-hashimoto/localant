import path from "node:path";
import { z } from "zod";
import type { Gateway } from "../gateway.js";

/**
 * Browser automation via Playwright. Playwright is an OPTIONAL peer dependency
 * to keep the base install light. A dedicated, isolated browser profile is
 * always used — never the user's day-to-day Chrome profile — unless they
 * explicitly opt in. Browser control is risk 3.
 */
type PwPage = { goto: (u: string) => Promise<unknown>; url: () => string; screenshot: (o: { path: string }) => Promise<unknown>; content: () => Promise<string>; innerText: (s: string) => Promise<string>; click: (s: string) => Promise<unknown>; fill: (s: string, v: string) => Promise<unknown>; waitForSelector: (s: string, o?: unknown) => Promise<unknown>; pdf: (o: { path: string }) => Promise<unknown>; keyboard: { press: (k: string) => Promise<unknown> }; selectOption: (s: string, v: string) => Promise<unknown>; evaluate: (fn: string) => Promise<unknown>; mouse: { wheel: (x: number, y: number) => Promise<unknown> }; on: (ev: string, cb: (msg: { text: () => string }) => void) => void; };
type PwBrowser = { newPage: () => Promise<PwPage>; close: () => Promise<unknown> };

let browser: PwBrowser | undefined;
let page: PwPage | undefined;
let useDefaultProfile = false;
const consoleLogs: string[] = [];

async function loadPlaywright(): Promise<{ chromium: { launch: (o?: unknown) => Promise<PwBrowser> } }> {
  try {
    // @ts-expect-error optional dependency resolved at runtime
    return (await import("playwright")) as { chromium: { launch: (o?: unknown) => Promise<PwBrowser> } };
  } catch {
    throw new Error(
      "Playwright is not installed. Install it to use browser tools: `npm i -D playwright && npx playwright install chromium`.",
    );
  }
}

export function registerBrowserTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "browser_use_profile",
    description: "Opt in to using a login-capable browser profile (default: isolated profile). Risk 3.",
    risk: 3,
    inputSchema: z.object({ useLoginProfile: z.boolean() }),
    summarize: (i) => `browser profile login=${i.useLoginProfile}`,
    handler: (i) => {
      useDefaultProfile = i.useLoginProfile;
      return { useLoginProfile: useDefaultProfile, warning: useDefaultProfile ? "Using a login profile exposes your sessions to automation." : undefined };
    },
  });

  r.register({
    name: "browser_open",
    description: "Open a URL in an isolated browser and return the title.",
    risk: 3,
    inputSchema: z.object({ url: z.string().url() }),
    summarize: (i) => `browser open ${i.url}`,
    handler: async (i) => {
      const { chromium } = await loadPlaywright();
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      consoleLogs.length = 0;
      page.on("console", (msg) => consoleLogs.push(msg.text()));
      await page.goto(i.url);
      return { opened: i.url, isolatedProfile: !useDefaultProfile };
    },
  });

  r.register({ name: "browser_close", description: "Close the browser.", risk: 1, inputSchema: z.object({}).strip(), handler: async () => { await browser?.close(); browser = undefined; page = undefined; return { closed: true }; } });
  r.register({ name: "browser_screenshot", description: "Screenshot the current page into the workspace.", risk: 3, inputSchema: z.object({}).strip(), summarize: () => "browser screenshot", handler: async () => { ensure(); const p = path.join(gw.paths.workspaceDir, `shot-${Date.now()}.png`); await page!.screenshot({ path: p }); return { path: p }; } });
  r.register({ name: "browser_extract_text", description: "Extract visible text from a selector (default body).", risk: 3, inputSchema: z.object({ selector: z.string().default("body") }), handler: async (i) => { ensure(); return { text: (await page!.innerText(i.selector)).slice(0, 50_000) }; } });
  r.register({ name: "browser_get_html", description: "Get the current page HTML.", risk: 3, inputSchema: z.object({}).strip(), handler: async () => { ensure(); return { html: (await page!.content()).slice(0, 200_000) }; } });
  r.register({ name: "browser_click", description: "Click an element by selector.", risk: 3, inputSchema: z.object({ selector: z.string() }), summarize: (i) => `browser click ${i.selector}`, handler: async (i) => { ensure(); await page!.click(i.selector); return { clicked: i.selector }; } });
  r.register({ name: "browser_type", description: "Type into an input by selector.", risk: 3, inputSchema: z.object({ selector: z.string(), text: z.string() }), summarize: (i) => `browser type into ${i.selector}`, handler: async (i) => { ensure(); await page!.fill(i.selector, i.text); return { typed: i.selector }; } });
  r.register({ name: "browser_wait_for", description: "Wait for a selector to appear.", risk: 3, inputSchema: z.object({ selector: z.string(), timeoutMs: z.number().int().default(10_000) }), handler: async (i) => { ensure(); await page!.waitForSelector(i.selector, { timeout: i.timeoutMs }); return { ready: i.selector }; } });
  r.register({ name: "browser_save_pdf", description: "Save the current page as PDF into the workspace.", risk: 3, inputSchema: z.object({}).strip(), summarize: () => "browser save pdf", handler: async () => { ensure(); const p = path.join(gw.paths.workspaceDir, `page-${Date.now()}.pdf`); await page!.pdf({ path: p }); return { path: p }; } });
  r.register({ name: "browser_get_url", description: "Get the current page URL.", risk: 3, inputSchema: z.object({}).strip(), handler: async () => { ensure(); return { url: page!.url() }; } });
  r.register({ name: "browser_press", description: "Press a keyboard key (e.g. Enter, Tab).", risk: 3, inputSchema: z.object({ key: z.string() }), summarize: (i) => `browser press ${i.key}`, handler: async (i) => { ensure(); await page!.keyboard.press(i.key); return { pressed: i.key }; } });
  r.register({ name: "browser_scroll", description: "Scroll the page by (x, y) pixels.", risk: 3, inputSchema: z.object({ x: z.number().default(0), y: z.number().default(600) }), handler: async (i) => { ensure(); await page!.mouse.wheel(i.x, i.y); return { scrolled: { x: i.x, y: i.y } }; } });
  r.register({ name: "browser_select", description: "Select an option in a <select> by selector + value.", risk: 3, inputSchema: z.object({ selector: z.string(), value: z.string() }), summarize: (i) => `browser select ${i.selector}`, handler: async (i) => { ensure(); await page!.selectOption(i.selector, i.value); return { selected: i.value }; } });
  r.register({ name: "browser_evaluate", description: "Evaluate JavaScript in the page context (risk 4).", risk: 4, inputSchema: z.object({ script: z.string() }), summarize: () => "browser evaluate JS", handler: async (i) => { ensure(); return { result: await page!.evaluate(i.script) }; } });
  r.register({ name: "browser_console_logs", description: "Return console logs captured since the page opened.", risk: 3, inputSchema: z.object({}).strip(), handler: async () => ({ logs: consoleLogs.slice(-200) }) });
}

function ensure(): void {
  if (!page) throw new Error("No browser page open. Call browser_open first.");
}
