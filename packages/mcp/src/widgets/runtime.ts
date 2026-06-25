/**
 * Shared client runtime for LocalAnt Apps SDK widgets.
 *
 * Every widget is a self-contained HTML document made of three parts:
 *   1. a `#root` element + an optional `#status` bar,
 *   2. a `window.LocalAntRender(ctx)` function the widget supplies,
 *   3. the shared {@link WIDGET_RUNTIME} script below.
 *
 * The runtime resolves the tool result (`structuredContent` -> `ctx.data`) and
 * `_meta` from both the ChatGPT `window.openai` runtime and the postMessage
 * bridge, re-renders on updates, and exposes `ctx.callTool()` so widget buttons
 * can drive `tools/call` back to the gateway (Apps SDK pattern).
 */

export interface WidgetCsp {
  connectDomains: string[];
  resourceDomains: string[];
}

export interface WidgetDef {
  /** Stable id, e.g. "approval-center". */
  id: string;
  /** Resource URI, e.g. "ui://localant/approval-center-v1.html". */
  uri: string;
  /** Human description shown in widget pickers. */
  description: string;
  /** Tool names whose result renders with this widget (outputTemplate). */
  tools: string[];
  /** Status label while the bound tool is running. */
  invoking: string;
  /** Status label once the bound tool has returned. */
  invoked: string;
  /** Full HTML document body for the widget resource. */
  html(): string;
  /** Optional CSP. Defaults to fully self-contained (no external domains). */
  csp?: WidgetCsp;
}

/** Options for {@link widgetDocument}. */
export interface WidgetDocumentOptions {
  /** Initial inner HTML for `#root` (a loading placeholder). */
  body: string;
  /** Widget-specific CSS appended after the shared base styles. */
  styles?: string;
  /**
   * Source of the `window.LocalAntRender` function, e.g.
   * `function (ctx) { ... }`. Receives the live render context.
   */
  render: string;
  /** Runtime config (e.g. `{ refreshTool: "approval_list_pending" }`). */
  config?: Record<string, unknown>;
}

/** Shared visual language for every widget. Kept compact and theme-aware. */
const BASE_STYLES = `
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --fg: #172033; --muted: #5b6472; --line: rgba(118,128,144,0.28); --card: rgba(118,128,144,0.06); --accent: #2f6feb; --danger: #d23b3b; --ok: #1f9d57; }
@media (prefers-color-scheme: dark) { :root { --fg: #edf1f7; --muted: #aab3c2; --line: rgba(170,179,194,0.24); --card: rgba(170,179,194,0.08); --accent: #5b8cff; --danger: #ff6b6b; --ok: #46c781; } }
body { margin: 0; }
.root { box-sizing: border-box; width: 100%; min-height: 80px; padding: 12px; color: var(--fg); font-size: 13px; line-height: 1.45; }
.empty, .error { color: var(--muted); }
.error { color: var(--danger); }
.title { font-weight: 600; font-size: 13px; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
.count { color: var(--muted); font-weight: 500; }
.cards { display: grid; gap: 8px; }
.card { border: 1px solid var(--line); border-radius: 10px; background: var(--card); padding: 10px 12px; display: grid; gap: 6px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.spread { justify-content: space-between; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.tag.risk0 { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.tag.risk1, .tag.risk2 { color: #c98a1a; border-color: rgba(201,138,26,0.5); }
.tag.risk3, .tag.risk4 { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.tag.on { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.tag.off { color: var(--muted); }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
button.ant { font: inherit; font-size: 12px; cursor: pointer; border-radius: 8px; padding: 5px 11px; border: 1px solid var(--line); background: transparent; color: var(--fg); }
button.ant:hover { background: var(--card); }
button.ant:disabled { opacity: 0.5; cursor: default; }
button.ant.primary { background: var(--accent); border-color: transparent; color: #fff; }
button.ant.danger { background: transparent; border-color: color-mix(in srgb, var(--danger) 55%, transparent); color: var(--danger); }
button.ant.danger:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); }
pre.out { margin: 0; padding: 8px 10px; max-height: 280px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--card); white-space: pre-wrap; word-break: break-word; font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
input.ant, textarea.ant { font: inherit; font-size: 12px; width: 100%; box-sizing: border-box; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
textarea.ant { resize: vertical; min-height: 38px; }
label.chk { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
.status { padding: 0 12px 10px; font-size: 12px; color: var(--muted); min-height: 0; }
.status.err { color: var(--danger); }
.status.ok { color: var(--ok); }
.diff-add { color: var(--ok); }
.diff-del { color: var(--danger); }
.diff-hd { color: var(--accent); }
`;

/** The shared runtime script, identical across every widget. */
const WIDGET_RUNTIME = `
(function () {
  var root = document.getElementById("root");
  var statusEl = document.getElementById("status");
  function openai() { return window.openai || {}; }
  function escapeHtml(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function formatBytes(n) { if (typeof n !== "number") return ""; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; return (n / 1048576).toFixed(1) + " MB"; }
  function fmtTime(iso) {
    if (!iso) return "";
    var t = new Date(iso).getTime();
    if (isNaN(t)) return String(iso);
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 0) s = 0;
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return new Date(t).toLocaleString();
  }
  // JSON-RPC 2.0 bridge over postMessage (MCP Apps standard).
  // Preferred over window.openai for tools/call and ui/message.
  var rpcId = 0;
  var rpcPending = {};
  function rpcRequest(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++rpcId;
      rpcPending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
      setTimeout(function () {
        var p = rpcPending[id];
        if (p) { delete rpcPending[id]; reject(new Error("RPC " + method + " timed out")); }
      }, 30000);
    });
  }
  function canRpc() { return window.parent && window.parent.postMessage; }
  function unwrap(r) {
    if (!r) return { result: null, data: null };
    var result = r.structuredContent || r.toolOutput || r.result || r;
    var data = result && typeof result === "object" && "data" in result ? result.data : result;
    return { result: result, data: data };
  }
  function resolveMeta() {
    var o = openai();
    var rm = o.toolResponseMetadata;
    if (rm) return (rm.call_tool_result && rm.call_tool_result._meta) || (rm.mcp_tool_result && rm.mcp_tool_result._meta) || rm._meta || rm;
    return {};
  }
  var ctx = { root: root, escapeHtml: escapeHtml, formatBytes: formatBytes, fmtTime: fmtTime };
  ctx.notify = function (msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  };
  // Prefer JSON-RPC tools/call, fall back to window.openai.callTool.
  ctx.callToolRaw = function (name, args) {
    if (canRpc()) return rpcRequest("tools/call", { name: name, arguments: args || {} });
    var fn = openai().callTool;
    if (!fn) return Promise.reject(new Error("Interactive actions require the ChatGPT app runtime."));
    return Promise.resolve(fn(name, args || {})).then(unwrap);
  };
  ctx.callTool = function (name, args) { return ctx.callToolRaw(name, args).then(function (u) { return u.data; }); };
  // Prefer JSON-RPC ui/message, fall back to window.openai.sendFollowUpMessage.
  ctx.sendFollowUpMessage = function (prompt) {
    if (canRpc()) return rpcRequest("ui/message", { role: "user", content: [{ type: "text", text: prompt }] });
    var fn = openai().sendFollowUpMessage;
    if (!fn) return Promise.reject(new Error("sendFollowUpMessage requires the ChatGPT app runtime."));
    return Promise.resolve(fn({ prompt: prompt }));
  };
  // JSON-RPC ui/update-model-context: tell the model about widget-side state.
  ctx.updateModelContext = function (text) {
    if (canRpc()) return rpcRequest("ui/update-model-context", { content: [{ type: "text", text: text }] });
    return Promise.reject(new Error("updateModelContext requires the MCP Apps bridge."));
  };
  // ChatGPT-only extensions (no JSON-RPC equivalent).
  ctx.requestDisplayMode = function (mode) {
    var fn = openai().requestDisplayMode;
    if (!fn) return Promise.reject(new Error("requestDisplayMode requires the ChatGPT app runtime."));
    return Promise.resolve(fn({ mode: mode }));
  };
  ctx.openExternal = function (href) {
    var fn = openai().openExternal;
    if (!fn) return Promise.reject(new Error("openExternal requires the ChatGPT app runtime."));
    return Promise.resolve(fn({ href: href }));
  };
  function apply(result, metaOverride) {
    ctx.result = result || {};
    ctx.data = ctx.result && typeof ctx.result === "object" && "data" in ctx.result ? ctx.result.data : ctx.result;
    ctx.error = ctx.result && ctx.result.ok === false ? (ctx.result.error || "The tool reported an error.") : null;
    ctx.meta = metaOverride || resolveMeta();
    ctx.toolInput = openai().toolInput || {};
    try { window.LocalAntRender(ctx); }
    catch (e) { root.innerHTML = '<div class="error">' + escapeHtml(String(e && e.message || e)) + "</div>"; }
  }
  ctx.setData = apply;
  ctx.reload = function () {
    var cfg = window.LocalAntConfig || {};
    if (!cfg.refreshTool || !openai().callTool) { apply(openai().toolOutput); return Promise.resolve(); }
    return ctx.callToolRaw(cfg.refreshTool, ctx.toolInput || {}).then(function (u) { apply(u.result); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
  };
  apply(openai().toolOutput);
  window.addEventListener("openai:set_globals", function (e) {
    var g = e.detail && e.detail.globals;
    if (g && "toolOutput" in g) apply(g.toolOutput);
  }, { passive: true });
  // Listen for JSON-RPC responses (tools/call result) and notifications
  // (ui/notifications/tool-result). Dispatches pending RPC promises and
  // applies tool-result updates.
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    // Response to a pending rpcRequest
    if (typeof m.id === "number") {
      var p = rpcPending[m.id];
      if (p) {
        delete rpcPending[m.id];
        if (m.error) p.reject(new Error(m.error.message || "RPC error"));
        else p.resolve(m.result);
      }
      return;
    }
    // Notification (no id) — tool result update
    if (m.method === "ui/notifications/tool-result") {
      var p = m.params || {};
      apply(p.structuredContent || p, p._meta);
    }
  }, { passive: true });
})();
`;

/** Assemble a complete widget HTML document from its parts. */
export function widgetDocument(opts: WidgetDocumentOptions): string {
  const config = JSON.stringify(opts.config ?? {});
  return `
<div id="root" class="root">${opts.body}</div>
<div id="status" class="status"></div>
<style>${BASE_STYLES}${opts.styles ?? ""}</style>
<script>window.LocalAntConfig = ${config};</script>
<script>window.LocalAntRender = ${opts.render};</script>
<script>${WIDGET_RUNTIME}</script>
`.trim();
}
