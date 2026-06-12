import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Skill panel: installed skills as cards showing risk, validity, enabled state
 * and exposed tools, with inline Enable / Disable / Validate actions so a skill
 * can be reviewed before it is turned on.
 */
const render = `function (ctx) {
  var list = Array.isArray(ctx.data) ? ctx.data : (ctx.data && ctx.data.name ? [ctx.data] : []);
  if (ctx.error && !list.length) { ctx.root.innerHTML = '<div class="error">' + ctx.escapeHtml(ctx.error) + "</div>"; return; }
  if (!list.length) { ctx.root.innerHTML = '<div class="empty">No skills installed.</div>'; return; }
  var S = window.LASkill = window.LASkill || {};
  var rows = list.map(function (sk) {
    var risk = typeof sk.riskLevel === "number" ? sk.riskLevel : 0;
    var tools = Array.isArray(sk.tools) ? sk.tools : [];
    return '<div class="card" data-name="' + ctx.escapeHtml(sk.name) + '">' +
      '<div class="row spread"><span style="font-weight:600">' + ctx.escapeHtml(sk.name) + ' <span class="muted small">' + ctx.escapeHtml(sk.version || "") + "</span></span>" +
        '<span class="row">' +
          '<span class="tag ' + (sk.enabled ? "on" : "off") + '">' + (sk.enabled ? "enabled" : "disabled") + "</span>" +
          '<span class="tag risk' + risk + '">risk ' + risk + "</span>" +
          (sk.valid === false ? '<span class="tag risk4">invalid</span>' : "") +
        "</span></div>" +
      (sk.description ? '<div class="small muted">' + ctx.escapeHtml(sk.description) + "</div>" : "") +
      (tools.length ? '<div class="row small muted mono">' + tools.slice(0, 8).map(function (t) { return ctx.escapeHtml(t); }).join(", ") + (tools.length > 8 ? " +" + (tools.length - 8) : "") + "</div>" : "") +
      (S.info && S.info.name === sk.name ? '<pre class="out">' + ctx.escapeHtml(S.info.text) + "</pre>" : "") +
      '<div class="btns">' +
        (sk.enabled
          ? '<button class="ant" data-act="disable">Disable</button>'
          : '<button class="ant primary" data-act="enable">Enable</button>') +
        '<button class="ant" data-act="validate">Validate</button>' +
        '<button class="ant" data-act="info">Info</button>' +
      "</div></div>";
  }).join("");
  ctx.root.innerHTML = '<div class="title">Skills <span class="count">' + list.length + "</span></div><div class=\\"cards\\">" + rows + "</div>";
  ctx.root.querySelectorAll(".card").forEach(function (card) {
    var name = card.getAttribute("data-name");
    function act(tool, args, ok) { return function () { ctx.notify(ok + "..."); ctx.callTool(tool, args).then(function (r) { ctx.notify(ok + ".", "ok"); return after(r); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); }); }; }
    function after(r) { return ctx.reload(); }
    var en = card.querySelector('button[data-act="enable"]'); if (en) en.addEventListener("click", act("skill_enable", { name: name }, "Enabling"));
    var di = card.querySelector('button[data-act="disable"]'); if (di) di.addEventListener("click", act("skill_disable", { name: name }, "Disabling"));
    card.querySelector('button[data-act="validate"]').addEventListener("click", function () {
      ctx.notify("Validating..."); ctx.callTool("skill_validate", { name: name }).then(function (r) {
        S.info = { name: name, text: JSON.stringify(r, null, 2) }; ctx.notify(r && r.valid === false ? "Invalid." : "Valid.", r && r.valid === false ? "err" : "ok"); window.LocalAntRender(ctx);
      }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
    });
    card.querySelector('button[data-act="info"]').addEventListener("click", function () {
      ctx.notify("Loading..."); ctx.callTool("skill_info", { name: name }).then(function (r) {
        var perms = r && r.manifest && r.manifest.permissions;
        S.info = { name: name, text: JSON.stringify(perms || r, null, 2) }; ctx.notify(""); window.LocalAntRender(ctx);
      }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
    });
  });
}`;

export const skillPanel: WidgetDef = {
  id: "skill-panel",
  uri: "ui://localant/skill-panel-v1.html",
  description: "Review installed LocalAnt skills, their permissions and validity, and enable or disable them.",
  // View tools only. validate / enable / disable are actions returning {ok:true};
  // binding the panel to them rendered the "No skills installed." empty state.
  // The panel drives those via its own inline buttons.
  tools: ["skill_list", "skill_info"],
  invoking: "Loading skills...",
  invoked: "Skills ready.",
  html: () => widgetDocument({ body: "Loading skills...", render, config: { refreshTool: "skill_list" } }),
};
