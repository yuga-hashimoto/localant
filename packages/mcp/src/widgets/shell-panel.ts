import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Shell process panel: tracked long-running processes with their command and
 * status, plus inline Output (stdout/stderr tail) and Stop actions.
 */
const render = `function (ctx) {
  var list = Array.isArray(ctx.data) ? ctx.data : (ctx.data && Array.isArray(ctx.data.processes) ? ctx.data.processes : []);
  if (ctx.error && !list.length) { ctx.root.innerHTML = '<div class="error">' + ctx.escapeHtml(ctx.error) + "</div>"; return; }
  var S = window.LAShell = window.LAShell || {};
  if (!list.length) { ctx.root.innerHTML = '<div class="empty">No tracked processes.</div>'; return; }
  var rows = list.map(function (p) {
    var on = p.status === "running";
    return '<div class="card" data-id="' + ctx.escapeHtml(p.id) + '">' +
      '<div class="row spread"><span class="mono small">' + ctx.escapeHtml(p.command || "") + "</span>" +
        '<span class="tag ' + (on ? "risk2" : (p.exitCode ? "risk4" : "off")) + '">' + ctx.escapeHtml(p.status || "?") + (typeof p.exitCode === "number" ? " " + p.exitCode : "") + "</span></div>" +
      '<div class="row small muted"><span class="mono">' + ctx.escapeHtml(p.id) + "</span><span>" + ctx.fmtTime(p.startedAt) + "</span></div>" +
      '<div class="btns"><button class="ant" data-act="out">Output</button>' + (on ? '<button class="ant danger" data-act="stop">Stop</button>' : "") + "</div>" +
      (S.outId === p.id ? '<pre class="out">' + ctx.escapeHtml(S.out || "(no output)") + "</pre>" : "") +
    "</div>";
  }).join("");
  ctx.root.innerHTML = '<div class="title">Processes <span class="count">' + list.length + "</span></div><div class=\\"cards\\">" + rows + "</div>";
  ctx.root.querySelectorAll(".card").forEach(function (card) {
    var id = card.getAttribute("data-id");
    var outBtn = card.querySelector('button[data-act="out"]');
    if (outBtn) outBtn.addEventListener("click", function () {
      ctx.notify("Loading output...");
      ctx.callTool("shell_get_process_output", { id: id }).then(function (r) {
        S.outId = id; S.out = [(r && r.stdout) || "", (r && r.stderr) || ""].filter(Boolean).join("\\n--- stderr ---\\n");
        ctx.notify(""); window.LocalAntRender(ctx);
      }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
    });
    var stopBtn = card.querySelector('button[data-act="stop"]');
    if (stopBtn) stopBtn.addEventListener("click", function () {
      stopBtn.disabled = true; ctx.notify("Stopping...");
      ctx.callTool("shell_stop_process", { id: id }).then(function () { ctx.notify("Stopped.", "ok"); return ctx.reload(); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); stopBtn.disabled = false; });
    });
  });
}`;

export const shellPanel: WidgetDef = {
  id: "shell-panel",
  uri: "ui://localant/shell-panel-v1.html",
  description: "List tracked LocalAnt shell processes, tail their output and stop them.",
  tools: ["shell_list_processes", "shell_get_process_output"],
  invoking: "Loading processes...",
  invoked: "Processes ready.",
  html: () => widgetDocument({ body: "Loading processes...", render, config: { refreshTool: "shell_list_processes" } }),
};
