import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * ADB panel: a tabbed view over device list, foreground activity, UI dump and
 * logcat — each rendered as readable text rather than raw JSON, with a button
 * per source to refresh it via `tools/call`.
 */
const TABS = [
  { key: "devices", tool: "adb_list_devices", label: "Devices" },
  { key: "activity", tool: "adb_get_current_activity", label: "Activity" },
  { key: "ui", tool: "adb_dump_ui", label: "UI dump" },
  { key: "logcat", tool: "adb_logcat", label: "Logcat" },
];

const render = `function (ctx) {
  var d = ctx.data || {};
  var TABS = ${JSON.stringify(TABS)};
  var S = window.LAAdb = window.LAAdb || { tab: "devices", out: {} };
  // The client cannot see which adb_* tool produced this result, so store the
  // first output we are handed under the active tab; later loads are explicit.
  if (typeof d.output === "string" && !S.captured) { S.out[S.tab] = d.output; S.captured = true; }

  var tabs = TABS.map(function (t) { return '<button class="ant' + (S.tab === t.key ? " primary" : "") + '" data-tab="' + t.key + '">' + t.label + "</button>"; }).join("");
  var body = S.out[S.tab];
  ctx.root.innerHTML =
    '<div class="title">ADB</div><div class="btns">' + tabs + '</div>' +
    '<pre class="out" style="margin-top:8px">' + (body ? ctx.escapeHtml(body.slice(0, 16000)) : "(press a tab to load)") + "</pre>" +
    '<div class="btns"><button class="ant" data-act="refresh">Refresh</button></div>';

  function load(key) {
    var t = TABS.filter(function (x) { return x.key === key; })[0];
    if (!t) return;
    ctx.notify("Loading " + t.label + "...");
    ctx.callTool(t.tool, {}).then(function (r) { S.out[key] = (r && r.output) || "(no output)"; S.captured = true; ctx.notify(""); window.LocalAntRender(ctx); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
  }
  ctx.root.querySelectorAll("button[data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { S.tab = b.getAttribute("data-tab"); if (!S.out[S.tab]) load(S.tab); else window.LocalAntRender(ctx); });
  });
  ctx.root.querySelector('button[data-act="refresh"]').addEventListener("click", function () { load(S.tab); });
}`;

export const adbPanel: WidgetDef = {
  id: "adb-panel",
  uri: "ui://localant/adb-panel-v1.html",
  description: "Inspect a connected Android device via ADB: devices, activity, UI dump and logcat.",
  tools: ["adb_list_devices", "adb_get_current_activity", "adb_dump_ui", "adb_logcat"],
  invoking: "Loading device...",
  invoked: "Device ready.",
  html: () => widgetDocument({ body: "Loading device...", render }),
};
