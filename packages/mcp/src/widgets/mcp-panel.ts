import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Downstream MCP server panel: registered servers with their command,
 * transport and enabled state, plus inline Tools (list) and Status drill-downs.
 */
const render = `function (ctx) {
  var servers = (ctx.data && ctx.data.servers) || {};
  var names = Object.keys(servers);
  if (ctx.error && !names.length) { ctx.root.innerHTML = '<div class="error">' + ctx.escapeHtml(ctx.error) + "</div>"; return; }
  if (!names.length) { ctx.root.innerHTML = '<div class="empty">No downstream MCP servers registered.</div>'; return; }
  var S = window.LAMcp = window.LAMcp || {};
  var rows = names.map(function (name) {
    var c = servers[name] || {};
    var cmd = [c.command].concat(Array.isArray(c.args) ? c.args : []).filter(Boolean).join(" ");
    return '<div class="card" data-name="' + ctx.escapeHtml(name) + '">' +
      '<div class="row spread"><span style="font-weight:600">' + ctx.escapeHtml(name) + "</span>" +
        '<span class="row"><span class="tag">' + ctx.escapeHtml(c.transport || "stdio") + "</span>" +
        '<span class="tag ' + (c.enabled !== false ? "on" : "off") + '">' + (c.enabled !== false ? "enabled" : "disabled") + "</span></span></div>" +
      '<div class="small muted mono">' + ctx.escapeHtml(cmd) + "</div>" +
      '<div class="btns"><button class="ant" data-act="tools">Tools</button><button class="ant" data-act="status">Status</button></div>' +
      (S.detail && S.detail.name === name ? '<pre class="out">' + ctx.escapeHtml(S.detail.text) + "</pre>" : "") +
    "</div>";
  }).join("");
  ctx.root.innerHTML = '<div class="title">MCP servers <span class="count">' + names.length + "</span></div><div class=\\"cards\\">" + rows + "</div>";
  ctx.root.querySelectorAll(".card").forEach(function (card) {
    var name = card.getAttribute("data-name");
    function show(tool, label) { return function () { ctx.notify(label + "..."); ctx.callTool(tool, { name: name }).then(function (r) { S.detail = { name: name, text: JSON.stringify(r, null, 2) }; ctx.notify(""); window.LocalAntRender(ctx); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); }); }; }
    card.querySelector('button[data-act="tools"]').addEventListener("click", show("mcp_server_list_tools", "Listing tools"));
    card.querySelector('button[data-act="status"]').addEventListener("click", show("mcp_server_status", "Checking status"));
  });
}`;

export const mcpPanel: WidgetDef = {
  id: "mcp-panel",
  uri: "ui://localant/mcp-panel-v1.html",
  description: "Inspect downstream MCP servers registered with LocalAnt: status and exposed tools.",
  tools: ["mcp_server_list", "mcp_server_list_tools", "mcp_server_status"],
  invoking: "Loading MCP servers...",
  invoked: "MCP servers ready.",
  html: () => widgetDocument({ body: "Loading MCP servers...", render, config: { refreshTool: "mcp_server_list" } }),
};
