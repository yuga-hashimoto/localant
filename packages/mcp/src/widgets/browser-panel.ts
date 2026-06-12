import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Browser panel: current page URL, captured console logs and extracted text in
 * one place, with buttons to refresh each via `tools/call`.
 */
const render = `function (ctx) {
  var d = ctx.data || {};
  var S = window.LABrowser = window.LABrowser || {};
  if (typeof d.url === "string") S.url = d.url;
  if (typeof d.opened === "string") S.url = d.opened;
  if (Array.isArray(d.logs)) S.logs = d.logs;
  if (typeof d.text === "string") S.text = d.text;

  ctx.root.innerHTML =
    '<div class="title">Browser</div>' +
    '<div class="card"><div class="row spread"><span class="mono small">' + ctx.escapeHtml(S.url || "(no page open)") + "</span></div>" +
      '<div class="btns"><button class="ant" data-act="url">Get URL</button><button class="ant" data-act="logs">Console logs</button><button class="ant" data-act="text">Extract text</button></div></div>' +
    (S.logs && S.logs.length ? '<div class="small muted" style="margin-top:8px">Console (' + S.logs.length + ')</div><pre class="out">' + ctx.escapeHtml(S.logs.slice(-200).join("\\n")) + "</pre>" : "") +
    (S.text ? '<div class="small muted" style="margin-top:8px">Page text</div><pre class="out">' + ctx.escapeHtml(S.text.slice(0, 12000)) + "</pre>" : "");

  function fetchTool(tool, args, label) { ctx.notify(label + "..."); ctx.callTool(tool, args || {}).then(function (r) { ctx.setData({ ok: true, data: r }); ctx.notify(""); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); }); }
  ctx.root.querySelector('button[data-act="url"]').addEventListener("click", function () { fetchTool("browser_get_url", {}, "Reading URL"); });
  ctx.root.querySelector('button[data-act="logs"]').addEventListener("click", function () { fetchTool("browser_console_logs", {}, "Reading logs"); });
  ctx.root.querySelector('button[data-act="text"]').addEventListener("click", function () { fetchTool("browser_extract_text", { selector: "body" }, "Extracting text"); });
}`;

export const browserPanel: WidgetDef = {
  id: "browser-panel",
  uri: "ui://localant/browser-panel-v1.html",
  description: "Inspect the LocalAnt browser: current URL, console logs and extracted page text.",
  tools: ["browser_open", "browser_get_url", "browser_console_logs", "browser_extract_text"],
  invoking: "Loading browser...",
  invoked: "Browser ready.",
  html: () => widgetDocument({ body: "Loading browser...", render }),
};
