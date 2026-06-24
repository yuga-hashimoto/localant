import type { WidgetDef } from "./runtime.js";
import { widgetDocument } from "./runtime.js";

/**
 * LocalAnt Home: a read-only cockpit rendered directly inside ChatGPT. It is the
 * obvious Apps SDK entry point users can ask for before drilling into specific
 * approval/git/shell/browser/MCP/skill panels.
 */
const render = `function (ctx) {
  var d = ctx.data || {};
  var rt = d.runtime || {};
  var sec = d.security || {};
  var tools = d.tools || {};
  var S = window.LAHome = window.LAHome || {};
  var approvals = Array.isArray(d.approvals) ? d.approvals : [];
  var processes = Array.isArray(d.processes) ? d.processes : [];
  var servers = d.mcpServers || {};
  var serverNames = Object.keys(servers);
  var skills = Array.isArray(d.skills) ? d.skills : [];
  var audit = Array.isArray(d.recentAudit) ? d.recentAudit : [];
  function tag(text, klass) { return '<span class="tag ' + (klass || "") + '">' + ctx.escapeHtml(text) + '</span>'; }
  function card(title, value, detail, klass) {
    return '<div class="metric">' +
      '<div class="metric-value ' + (klass || "") + '">' + ctx.escapeHtml(value) + '</div>' +
      '<div class="metric-title">' + ctx.escapeHtml(title) + '</div>' +
      (detail ? '<div class="small muted">' + ctx.escapeHtml(detail) + '</div>' : '') +
    '</div>';
  }
  var head = '<div class="hero">' +
    '<div><div class="title">LocalAnt</div><div class="small muted">ChatGPT UI home panel</div></div>' +
    '<div class="row">' + tag('v' + (d.version || '?')) + tag(sec.mode || 'unknown', 'risk' + (sec.mode === 'yolo' ? 3 : sec.mode === 'open' ? 2 : 1)) + '</div>' +
  '</div>';
  var metrics = '<div class="metrics">' +
    card('Approvals', String(approvals.length), approvals.length ? 'waiting for you' : 'none pending', approvals.length ? 'warn' : 'ok') +
    card('Processes', String(processes.length), processes.filter(function (p) { return p.status === 'running'; }).length + ' running') +
    card('MCP servers', String(serverNames.length), serverNames.filter(function (n) { return (servers[n] || {}).enabled !== false; }).length + ' enabled') +
    card('Skills', String(skills.length), skills.filter(function (s) { return s.enabled; }).length + ' enabled') +
    card('Tools', String(tools.exposed || 0), (tools.profile || '?') + ' profile / ' + (tools.registered || 0) + ' registered') +
  '</div>';
  var conn = '<div class="card"><div class="row spread"><b>Connection</b>' + tag(rt.tunnel && rt.tunnel.url ? 'tunnel on' : 'local only', rt.tunnel && rt.tunnel.url ? 'on' : 'off') + '</div>' +
    '<div class="small muted mono">Gateway: ' + ctx.escapeHtml(rt.gateway || '(not bound)') + '</div>' +
    '<div class="small muted mono">Dashboard: ' + ctx.escapeHtml(rt.dashboard || '(disabled)') + '</div>' +
    '<div class="small muted mono">MCP: ' + ctx.escapeHtml(rt.mcpEndpoint || '(no tunnel endpoint)') + '</div>' +
    '<div class="small muted mono">Started: ' + ctx.escapeHtml(d.startedAt || '') + '</div></div>';
  var appr = approvals.length ? approvals.slice(0, 5).map(function (a) {
    return '<div class="item">' +
      '<div class="row spread"><span class="mono">' + ctx.escapeHtml(a.tool || '?') + '</span>' + tag('risk ' + (a.risk || 0), 'risk' + (a.risk || 0)) + '</div>' +
      '<div class="small muted">' + ctx.escapeHtml(a.summary || a.reason || '') + '</div>' +
    '</div>';
  }).join('') : '<div class="empty">No pending approvals.</div>';
  var proc = processes.length ? processes.slice(0, 5).map(function (p) {
    return '<div class="item"><div class="row spread"><span class="mono small">' + ctx.escapeHtml(p.command || p.id || '?') + '</span>' + tag(p.status || '?', p.status === 'running' ? 'risk2' : 'off') + '</div></div>';
  }).join('') : '<div class="empty">No tracked processes.</div>';
  var mcp = serverNames.length ? serverNames.slice(0, 6).map(function (n) {
    var s = servers[n] || {};
    return '<div class="item"><div class="row spread"><b>' + ctx.escapeHtml(n) + '</b><span class="row">' + tag(s.transport || 'stdio') + tag(s.enabled !== false ? 'enabled' : 'disabled', s.enabled !== false ? 'on' : 'off') + '</span></div></div>';
  }).join('') : '<div class="empty">No downstream MCP servers registered.</div>';
  var skillRows = skills.length ? skills.slice(0, 6).map(function (s) {
    return '<div class="item"><div class="row spread"><b>' + ctx.escapeHtml(s.name || '?') + '</b><span class="row">' + tag(s.enabled ? 'enabled' : 'disabled', s.enabled ? 'on' : 'off') + tag('risk ' + (s.riskLevel || 0), 'risk' + (s.riskLevel || 0)) + '</span></div>' +
      (s.description ? '<div class="small muted">' + ctx.escapeHtml(s.description) + '</div>' : '') + '</div>';
  }).join('') : '<div class="empty">No skills installed.</div>';
  var logs = audit.length ? audit.map(function (e) {
    return '<div class="item"><div class="row spread"><span class="mono">' + ctx.escapeHtml(e.tool || '?') + '</span>' + tag(e.error ? 'error' : e.approval || 'ok', e.error ? 'risk4' : 'off') + '</div>' +
      '<div class="small muted">' + ctx.escapeHtml(ctx.fmtTime(e.timestamp)) + ' · ' + ctx.escapeHtml(String(e.durationMs || 0)) + 'ms' + (e.error ? ' · ' + ctx.escapeHtml(e.error) : '') + '</div></div>';
  }).join('') : '<div class="empty">No recent audit entries.</div>';
  var detail = S.detail ? '<div class="card"><div class="row spread"><b>' + ctx.escapeHtml(S.detail.label) + '</b><button class="ant" data-act="clear-detail">Clear</button></div><pre class="out">' + ctx.escapeHtml(S.detail.text) + '</pre></div>' : '';
  ctx.root.innerHTML = head + metrics + conn +
    '<div class="grid2">' +
      '<div class="card"><div class="row spread"><b>Approvals</b><button class="ant" data-open="approvals">Inspect</button></div>' + appr + '</div>' +
      '<div class="card"><div class="row spread"><b>Processes</b><button class="ant" data-open="processes">Inspect</button></div>' + proc + '</div>' +
      '<div class="card"><div class="row spread"><b>MCP servers</b><button class="ant" data-open="mcp">Inspect</button></div>' + mcp + '</div>' +
      '<div class="card"><div class="row spread"><b>Skills</b><button class="ant" data-open="skills">Inspect</button></div>' + skillRows + '</div>' +
    '</div>' + detail +
    '<div class="card"><div class="row spread"><b>Recent audit</b><button class="ant" data-act="refresh">Refresh</button></div>' + logs + '</div>';
  function openPanel(tool, args, label) {
    ctx.notify('Loading ' + label + '...');
    ctx.callTool(tool, args || {}).then(function (data) { S.detail = { label: label, text: JSON.stringify(data, null, 2) }; ctx.notify(''); window.LocalAntRender(ctx); }).catch(function (e) { ctx.notify(String(e && e.message || e), 'err'); });
  }
  ctx.root.querySelector('button[data-act="refresh"]').addEventListener('click', function () { S.detail = null; ctx.reload(); });
  var clear = ctx.root.querySelector('button[data-act="clear-detail"]');
  if (clear) clear.addEventListener('click', function () { S.detail = null; window.LocalAntRender(ctx); });
  ctx.root.querySelector('button[data-open="approvals"]').addEventListener('click', function () { openPanel('approval_list_pending', {}, 'approvals'); });
  ctx.root.querySelector('button[data-open="processes"]').addEventListener('click', function () { openPanel('shell_list_processes', {}, 'processes'); });
  ctx.root.querySelector('button[data-open="mcp"]').addEventListener('click', function () { openPanel('mcp_server_list', {}, 'MCP servers'); });
  ctx.root.querySelector('button[data-open="skills"]').addEventListener('click', function () { openPanel('skill_list', {}, 'skills'); });
}`;

const styles = `
.hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-bottom: 8px; }
.metric { border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; background: var(--card); }
.metric-value { font-size: 20px; font-weight: 700; line-height: 1; }
.metric-value.ok { color: var(--ok); }
.metric-value.warn { color: #c98a1a; }
.metric-title { font-size: 11px; color: var(--muted); margin-top: 4px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin: 8px 0; }
.item { border-top: 1px solid var(--line); padding-top: 7px; margin-top: 7px; }
`;

export const localantHome: WidgetDef = {
  id: "localant-home",
  uri: "ui://localant/home-v1.html",
  description: "LocalAnt home cockpit for ChatGPT: status, approvals, processes, MCP servers, skills and audit activity.",
  tools: ["localant_ui"],
  invoking: "Opening LocalAnt...",
  invoked: "LocalAnt ready.",
  html: () => widgetDocument({ body: "Opening LocalAnt...", styles, render, config: { refreshTool: "localant_ui" } }),
};
