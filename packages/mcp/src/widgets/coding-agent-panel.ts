import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Coding-agent task panel: task metadata + status, a logs tail and diff viewer
 * (fetched via `tools/call`), live polling while the task runs, plus Stop,
 * Continue and Refresh actions in a single panel.
 */
const render = `function (ctx) {
  var d = ctx.data || {};
  var task = d.task || (d.id ? d : null);
  if (!task) { ctx.root.innerHTML = ctx.error ? '<div class="error">' + ctx.escapeHtml(ctx.error) + "</div>" : '<div class="empty">No task to display.</div>'; return; }
  var taskId = task.id;
  var S = window.LAState = window.LAState || {};
  if (S.taskId !== taskId) { S.taskId = taskId; S.tab = "logs"; S.logs = typeof d.logs === "string" ? d.logs : ""; S.diff = typeof d.diff === "string" ? d.diff : ""; S.loaded = false; if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  function refresh(reloadBodies) { if (reloadBodies) S.loaded = false; return ctx.callToolRaw("coding_agent_get_task", { taskId: taskId }).then(function (u) { ctx.setData(u.result); }); }
  function paneInner() {
    var body = S.tab === "diff" ? S.diff : S.logs;
    if (!body) return '<pre class="out muted">' + (S.loaded ? "(empty)" : "loading...") + "</pre>";
    if (S.tab === "diff") return '<pre class="out">' + colorDiff(body) + "</pre>";
    return '<pre class="out">' + ctx.escapeHtml(body.slice(-12000)) + "</pre>";
  }
  function colorDiff(t) {
    return t.split("\\n").map(function (ln) {
      var e = ctx.escapeHtml(ln);
      if (ln.indexOf("+") === 0 && ln.indexOf("+++") !== 0) return '<span class="diff-add">' + e + "</span>";
      if (ln.indexOf("-") === 0 && ln.indexOf("---") !== 0) return '<span class="diff-del">' + e + "</span>";
      if (ln.indexOf("@@") === 0 || ln.indexOf("diff ") === 0) return '<span class="diff-hd">' + e + "</span>";
      return e;
    }).join("\\n");
  }
  function updatePane() { var p = document.getElementById("pane"); if (p) p.innerHTML = paneInner(); }

  var running = task.status === "running" || task.status === "queued";
  var statusCls = task.status === "completed" ? "on" : (task.status === "failed" ? "risk4" : (running ? "risk2" : "off"));
  ctx.root.innerHTML =
    '<div class="card">' +
      '<div class="row spread"><span style="font-weight:600">' + ctx.escapeHtml(task.agent || "agent") + " &middot; " + ctx.escapeHtml(task.mode || "execute") + "</span>" +
        '<span class="tag ' + statusCls + '">' + ctx.escapeHtml(task.status || "?") + "</span></div>" +
      '<div class="small">' + ctx.escapeHtml(task.task || "") + "</div>" +
      '<div class="row small muted">' +
        '<span class="mono">' + ctx.escapeHtml(task.cwd || "") + "</span>" +
        (task.branch ? '<span class="tag">' + ctx.escapeHtml(task.branch) + "</span>" : "") +
        "<span>" + ctx.fmtTime(task.createdAt) + "</span>" +
        (typeof task.exitCode === "number" ? "<span>exit " + task.exitCode + "</span>" : "") +
      "</div>" +
      '<div class="btns">' +
        '<button class="ant" data-tab="logs">Logs</button>' +
        '<button class="ant" data-tab="diff">Diff</button>' +
        '<button class="ant" data-act="refresh">Refresh</button>' +
        (running ? '<button class="ant danger" data-act="stop">Stop</button>' : "") +
      "</div>" +
      '<div id="pane">' + paneInner() + "</div>" +
      '<div class="row"><textarea class="ant" id="cont" placeholder="Continue this task with more instructions..."></textarea></div>' +
      '<div class="btns"><button class="ant primary" data-act="continue">Continue</button></div>' +
    "</div>";

  ctx.root.querySelectorAll("button[data-tab]").forEach(function (b) {
    if (b.getAttribute("data-tab") === S.tab) b.classList.add("primary");
    b.addEventListener("click", function () { S.tab = b.getAttribute("data-tab"); ctx.root.querySelectorAll("button[data-tab]").forEach(function (x) { x.classList.toggle("primary", x === b); }); updatePane(); });
  });
  var stop = ctx.root.querySelector('button[data-act="stop"]');
  if (stop) stop.addEventListener("click", function () { stop.disabled = true; ctx.notify("Stopping..."); ctx.callTool("coding_agent_stop_task", { taskId: taskId }).then(function () { ctx.notify("Stop requested.", "ok"); return refresh(false); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); stop.disabled = false; }); });
  ctx.root.querySelector('button[data-act="refresh"]').addEventListener("click", function () { ctx.notify("Refreshing..."); refresh(true).then(function () { ctx.notify(""); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); }); });
  ctx.root.querySelector('button[data-act="continue"]').addEventListener("click", function () {
    var ta = document.getElementById("cont"); var val = (ta && ta.value || "").trim();
    if (!val) { ctx.notify("Enter instructions to continue.", "err"); return; }
    ctx.notify("Continuing task...");
    ctx.callTool("coding_agent_continue_task", { taskId: taskId, task: val }).then(function () { if (ta) ta.value = ""; ctx.notify("Continued.", "ok"); return refresh(true); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
  });

  if (!S.loaded) {
    S.loaded = true;
    Promise.all([
      ctx.callTool("coding_agent_get_logs", { taskId: taskId }).catch(function () { return null; }),
      ctx.callTool("coding_agent_get_diff", { taskId: taskId }).catch(function () { return null; })
    ]).then(function (res) {
      if (res[0] && typeof res[0].logs === "string") S.logs = res[0].logs;
      if (res[1] && typeof res[1].diff === "string") S.diff = res[1].diff;
      updatePane();
    });
  }
  if (running && !S.timer) {
    S.timer = setInterval(function () {
      ctx.callTool("coding_agent_get_logs", { taskId: S.taskId }).then(function (lg) { if (lg && typeof lg.logs === "string") { S.logs = lg.logs; updatePane(); } }).catch(function () {});
      ctx.callTool("coding_agent_get_task", { taskId: S.taskId }).then(function (t) { if (t && t.status && t.status !== task.status) { S.loaded = false; ctx.setData({ ok: true, data: t }); } }).catch(function () {});
    }, 3000);
  } else if (!running && S.timer) { clearInterval(S.timer); S.timer = null; }
}`;

export const codingAgentPanel: WidgetDef = {
  id: "coding-agent-panel",
  uri: "ui://localant/coding-agent-panel-v1.html",
  description: "Monitor a LocalAnt coding-agent task: status, logs, diff, stop and continue.",
  tools: ["coding_agent_get_task", "coding_agent_start_task", "coding_agent_get_result", "coding_agent_continue_task"],
  invoking: "Loading task...",
  invoked: "Task ready.",
  html: () => widgetDocument({ body: "Loading task...", render }),
};
