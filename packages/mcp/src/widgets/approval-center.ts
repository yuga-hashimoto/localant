import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Approval center: pending risky-tool requests rendered as cards with the
 * originating tool, risk, reason, summary and session, plus inline
 * Approve (once / session) and Deny buttons that drive `tools/call`.
 */
const render = `function (ctx) {
  var list = Array.isArray(ctx.data) ? ctx.data : (ctx.data && ctx.data.id ? [ctx.data] : []);
  var pending = list.filter(function (a) { return a && (!a.status || a.status === "pending"); });
  if (ctx.error && !pending.length) { ctx.root.innerHTML = '<div class="error">' + ctx.escapeHtml(ctx.error) + "</div>"; return; }
  if (!pending.length) { ctx.root.innerHTML = '<div class="empty">No pending approvals. You are all caught up.</div>'; return; }
  var cards = pending.map(function (a) {
    var risk = typeof a.risk === "number" ? a.risk : 0;
    var dbl = a.requirement === "double";
    var prog = dbl ? " &middot; " + (a.approvalsGiven || 0) + "/2 approvals" : "";
    return '<div class="card" data-id="' + ctx.escapeHtml(a.id) + '">' +
      '<div class="row spread"><span class="mono" style="font-weight:600">' + ctx.escapeHtml(a.tool || "?") + "</span>" +
      '<span class="tag risk' + risk + '">risk ' + risk + (dbl ? " &middot; double" : "") + "</span></div>" +
      (a.summary ? '<div class="small">' + ctx.escapeHtml(a.summary) + "</div>" : "") +
      (a.reason ? '<div class="small muted">' + ctx.escapeHtml(a.reason) + "</div>" : "") +
      '<div class="row small muted">' +
        "<span>" + ctx.escapeHtml(a.caller || "?") + "</span>" +
        (a.sessionId ? '<span class="mono">chat ' + ctx.escapeHtml(String(a.sessionId).slice(0, 8)) + "</span>" : "") +
        "<span>" + ctx.fmtTime(a.createdAt) + "</span>" + prog +
      "</div>" +
      '<div class="btns">' +
        '<button class="ant primary" data-act="once">Approve once</button>' +
        '<button class="ant" data-act="session">Approve session</button>' +
        '<button class="ant danger" data-act="deny">Deny</button>' +
      "</div></div>";
  }).join("");
  ctx.root.innerHTML = '<div class="title">Pending approvals <span class="count">' + pending.length + "</span></div><div class=\\"cards\\">" + cards + "</div>";
  ctx.root.querySelectorAll(".card").forEach(function (card) {
    var id = card.getAttribute("data-id");
    card.querySelectorAll("button[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-act");
        card.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
        var call = act === "deny"
          ? ctx.callTool("approval_deny", { id: id })
          : ctx.callTool("approval_approve", { id: id, scope: act === "session" ? "session" : "once" });
        ctx.notify(act === "deny" ? "Denying..." : "Approving...");
        call.then(function () { ctx.notify(act === "deny" ? "Denied." : "Approved.", "ok"); return ctx.reload(); })
          .catch(function (e) {
            ctx.notify(String(e && e.message || e), "err");
            card.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
          });
      });
    });
  });
}`;

export const approvalCenter: WidgetDef = {
  id: "approval-center",
  uri: "ui://localant/approval-center-v1.html",
  description: "Review pending LocalAnt approval requests and approve or deny them inline.",
  tools: ["approval_list_pending", "approval_get", "approval_approve", "approval_deny"],
  invoking: "Loading approvals...",
  invoked: "Approvals ready.",
  html: () => widgetDocument({ body: "Loading approvals...", render, config: { refreshTool: "approval_list_pending" } }),
};
