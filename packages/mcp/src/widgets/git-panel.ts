import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * Git panel: the changed-file list with stage checkboxes, a per-file diff
 * viewer, a commit-message box and Stage / Commit / Refresh actions — so a long
 * diff never has to be read inline in ChatGPT.
 */
const render = `function (ctx) {
  var repo = (ctx.toolInput && ctx.toolInput.repo) || (ctx.data && ctx.data.repo) || "";
  var S = window.LAGit = window.LAGit || {};
  if (S.repo !== repo) { S.repo = repo; S.files = null; S.diff = ""; S.selected = ""; S.loaded = false; }
  if (!repo) { ctx.root.innerHTML = '<div class="empty">Open this panel from a git tool that includes a repo path.</div>'; return; }

  function parse(out) {
    return String(out || "").split("\\n").filter(function (l) { return l.trim().length; }).map(function (l) {
      return { status: l.slice(0, 2).trim() || "?", path: l.slice(3).trim() || l.trim() };
    });
  }
  function colorDiff(t) {
    return String(t || "").split("\\n").map(function (ln) {
      var e = ctx.escapeHtml(ln);
      if (ln.indexOf("+") === 0 && ln.indexOf("+++") !== 0) return '<span class="diff-add">' + e + "</span>";
      if (ln.indexOf("-") === 0 && ln.indexOf("---") !== 0) return '<span class="diff-del">' + e + "</span>";
      if (ln.indexOf("@@") === 0 || ln.indexOf("diff ") === 0) return '<span class="diff-hd">' + e + "</span>";
      return e;
    }).join("\\n");
  }
  function reload() { return ctx.callTool("git_list_changed_files", { repo: repo }).then(function (r) { S.files = parse(r && r.output); paint(); }); }
  function paint() { try { window.LocalAntRender(ctx); } catch (e) {} }

  if (!S.loaded) { S.loaded = true; if (ctx.data && typeof ctx.data.output === "string") S.files = parse(ctx.data.output); reload(); }

  var files = S.files || [];
  var rows = files.length ? files.map(function (f) {
    var sel = S.selected === f.path ? " primary" : "";
    return '<div class="row" data-path="' + ctx.escapeHtml(f.path) + '">' +
      '<label class="chk"><input type="checkbox" data-file="' + ctx.escapeHtml(f.path) + '">' +
      '<span class="tag mono">' + ctx.escapeHtml(f.status) + "</span></label>" +
      '<button class="ant' + sel + '" data-diff="' + ctx.escapeHtml(f.path) + '" style="flex:1;text-align:left">' + ctx.escapeHtml(f.path) + "</button></div>";
  }).join("") : '<div class="empty">' + (S.loaded ? "Working tree clean." : "loading...") + "</div>";

  ctx.root.innerHTML =
    '<div class="title">Changes <span class="count">' + ctx.escapeHtml(repo) + "</span></div>" +
    '<div class="cards">' + rows + "</div>" +
    (S.selected ? '<div class="small muted" style="margin-top:8px">' + ctx.escapeHtml(S.selected) + '</div><pre class="out">' + colorDiff(S.diff) + "</pre>" : "") +
    '<div class="row" style="margin-top:8px"><input class="ant" id="msg" placeholder="Commit message"></div>' +
    '<div class="btns">' +
      '<button class="ant" data-act="stage">Stage selected</button>' +
      '<button class="ant primary" data-act="commit">Commit</button>' +
      '<button class="ant" data-act="refresh">Refresh</button>' +
    "</div>";

  ctx.root.querySelectorAll("button[data-diff]").forEach(function (b) {
    b.addEventListener("click", function () {
      var file = b.getAttribute("data-diff");
      S.selected = file; ctx.notify("Loading diff...");
      ctx.callTool("git_diff_file", { repo: repo, file: file }).then(function (r) { S.diff = (r && r.output) || "(no diff)"; ctx.notify(""); paint(); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
    });
  });
  function selected() { return Array.prototype.slice.call(ctx.root.querySelectorAll("input[data-file]:checked")).map(function (c) { return c.getAttribute("data-file"); }); }
  ctx.root.querySelector('button[data-act="stage"]').addEventListener("click", function () {
    var paths = selected();
    ctx.notify("Staging " + (paths.length || "all") + "...");
    ctx.callTool("git_add", { repo: repo, paths: paths }).then(function () { ctx.notify("Staged.", "ok"); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
  });
  ctx.root.querySelector('button[data-act="commit"]').addEventListener("click", function () {
    var msg = (document.getElementById("msg") || {}).value || "";
    if (!msg.trim()) { ctx.notify("Enter a commit message.", "err"); return; }
    var paths = selected();
    ctx.notify("Committing...");
    var stage = paths.length ? ctx.callTool("git_add", { repo: repo, paths: paths }) : Promise.resolve();
    stage.then(function () { return ctx.callTool("git_commit", { repo: repo, message: msg, addAll: paths.length === 0 }); })
      .then(function () { ctx.notify("Committed.", "ok"); return reload(); })
      .catch(function (e) { ctx.notify(String(e && e.message || e), "err"); });
  });
  ctx.root.querySelector('button[data-act="refresh"]').addEventListener("click", function () { ctx.notify("Refreshing..."); reload().then(function () { ctx.notify(""); }).catch(function (e) { ctx.notify(String(e && e.message || e), "err"); }); });
}`;

export const gitPanel: WidgetDef = {
  id: "git-panel",
  uri: "ui://localant/git-panel-v1.html",
  description: "Review changed files, view per-file diffs, stage and commit in a LocalAnt repo.",
  // View tools only. git_commit / git_add are actions that return {ok:true};
  // the panel self-loads via its own callTool, and binding it to a mutation
  // would render a "Changes ready." panel after a commit. Open it from a view.
  tools: ["git_status", "git_list_changed_files", "git_diff"],
  invoking: "Loading changes...",
  invoked: "Changes ready.",
  html: () => widgetDocument({ body: "Loading changes...", render }),
};
