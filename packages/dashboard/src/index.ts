/**
 * Self-contained local dashboard. Returns a single HTML document that talks to
 * the gateway's /api/* endpoints on the same origin. Local-only by default.
 *
 * Dependency-free and build-free by design: this ships as one HTML string so
 * the dashboard works with zero build steps and no CDN requirement. The inner
 * <script> uses string concatenation (no template literals) so it can live
 * inside this outer template literal without escaping collisions.
 */

export function dashboardHtml(token = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/png" href="/favicon.png" />
<title>LocalAnt — Dashboard</title>
<style>
  :root { --bg:#0b0f17; --panel:#131a26; --panel2:#1b2433; --text:#e6edf3; --muted:#8b98a9; --accent:#4f8cff; --danger:#ff5f56; --ok:#3fb950; --warn:#d29922; --border:#243049; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }
  header { padding:14px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; }
  header .logo { display:flex; align-items:center; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  .pill { font-size:11px; padding:2px 8px; border-radius:999px; background:var(--panel2); color:var(--muted); }
  .layout { display:flex; min-height:calc(100vh - 53px); }
  nav { width:190px; border-right:1px solid var(--border); padding:12px; }
  nav button { display:block; width:100%; text-align:left; background:none; border:none; color:var(--muted); padding:9px 12px; border-radius:8px; cursor:pointer; font-size:14px; }
  nav button.active, nav button:hover { background:var(--panel); color:var(--text); }
  main { flex:1; padding:24px; overflow:auto; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px; }
  .card h2 { margin:0 0 12px; font-size:14px; }
  .card h3 { margin:16px 0 8px; font-size:13px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  pre { background:var(--panel2); padding:12px; border-radius:8px; overflow:auto; font-size:12px; max-height:380px; }
  button.btn { background:var(--accent); color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px; }
  button.btn:disabled { opacity:.5; cursor:not-allowed; }
  button.btn.ghost { background:var(--panel2); color:var(--text); }
  button.btn.danger { background:var(--danger); }
  button.btn.ok { background:var(--ok); }
  button.btn.sm { padding:3px 9px; font-size:11px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:8px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:500; }
  input,textarea,select { background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:8px; font-size:13px; font-family:inherit; }
  textarea { width:100%; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  label { font-size:13px; }
  .muted { color:var(--muted); }
  .tag { font-size:11px; padding:2px 6px; border-radius:6px; background:var(--panel2); }
  .tag.core { background:rgba(210,153,34,.18); color:var(--warn); }
  .risk0{color:var(--ok)} .risk1{color:#7fd} .risk2{color:var(--warn)} .risk3{color:#ff9} .risk4{color:var(--danger)}
  .warnbox { background:rgba(210,153,34,.12); border:1px solid var(--warn); color:#f0d590; padding:10px 12px; border-radius:8px; font-size:13px; margin-bottom:16px; }
  #toast { position:fixed; top:16px; right:16px; max-width:420px; z-index:50; display:flex; flex-direction:column; gap:8px; }
  .toast { padding:10px 14px; border-radius:8px; font-size:13px; box-shadow:0 4px 16px rgba(0,0,0,.4); }
  .toast.err { background:#3a1416; border:1px solid var(--danger); color:#ffb3ae; }
  .toast.ok { background:#10271a; border:1px solid var(--ok); color:#9be6ad; }
  .field { margin-bottom:14px; }
  .field label { display:block; margin-bottom:6px; font-weight:600; }
  .field input, .field select { width:100%; }
  .spin { display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:sp .7s linear infinite; vertical-align:middle; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .navbadge { background:var(--danger); color:#fff; border-radius:999px; padding:0 6px; font-size:11px; margin-left:6px; }
  #modalOverlay { position:fixed; inset:0; background:rgba(0,0,0,.6); display:none; align-items:center; justify-content:center; z-index:60; padding:24px; }
  #modalOverlay.show { display:flex; }
  .modal { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px; max-width:560px; width:100%; max-height:82vh; overflow:auto; }
  .modal h2 { margin:0 0 12px; font-size:15px; }
  .modal .close { float:right; cursor:pointer; color:var(--muted); background:none; border:none; font-size:20px; line-height:1; }
  .modal table td { font-size:12px; }
  .modal table td:first-child { color:var(--muted); white-space:nowrap; width:1%; padding-right:16px; }
  @media (max-width:720px){
    .layout { flex-direction:column; }
    nav { width:100%; border-right:none; border-bottom:1px solid var(--border); display:flex; flex-wrap:wrap; gap:4px; }
    nav button { width:auto; flex:0 0 auto; }
    main { padding:16px; }
    header { padding:12px 16px; }
    /* Approvals are the action most likely done from a phone — make every
       choice a full-width, thumb-sized tap target stacked vertically. */
    .approval-actions { flex-direction:column; align-items:stretch; }
    .approval-actions .btn { width:100%; padding:12px; font-size:15px; }
  }
</style>
</head>
<body>
<div id="toast"></div>
<div id="modalOverlay"><div class="modal" id="modalBox"></div></div>
<header>
  <span class="logo"><img src="/hero.png" height="26" alt="LocalAnt" /></span>
  <h1>LocalAnt</h1>
  <span class="pill" id="statusPill">connecting…</span>
  <span class="pill" id="tunnelPill"></span>
</header>
<div class="layout">
  <nav id="nav"></nav>
  <main id="main"></main>
</div>
<script>
const TABS = ["Home","Tools","Security","Approvals","Audit","Secrets","Autopilot","Settings"];
let current = "Home";
let toolSub = "tools";
let pendingApprovals = 0;
let logTimers = [];
function clearLogTimers(){ logTimers.forEach(clearInterval); logTimers=[]; }
const DASH_TOKEN = ${JSON.stringify(token)};

function openModal(title, html){
  document.getElementById('modalBox').innerHTML='<button class="close" id="modalClose">×</button><h2>'+esc(title)+'</h2>'+html;
  document.getElementById('modalOverlay').classList.add('show');
  document.getElementById('modalClose').onclick=closeModal;
}
function closeModal(){ document.getElementById('modalOverlay').classList.remove('show'); }

// Wire a Show/Hide button to toggle a password input's visibility.
function wirePw(inputId, btnId){
  const inp=document.getElementById(inputId), btn=document.getElementById(btnId);
  if(!inp||!btn) return;
  btn.onclick=()=>{ const show=inp.type==='password'; inp.type=show?'text':'password'; btn.textContent=show?'Hide':'Show'; };
}

function toast(msg, kind){
  const wrap=document.getElementById('toast');
  const t=document.createElement('div');
  t.className='toast '+(kind||'ok');
  t.textContent=msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .4s'; setTimeout(()=>t.remove(),400); }, kind==='err'?6000:3000);
}

// api() surfaces errors instead of swallowing them: non-2xx or a JSON {error}
// both throw, so every caller can show the failure in a toast.
async function api(p, opts){
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, o.headers, { "x-dashboard-token": DASH_TOKEN });
  const r = await fetch("/api/"+p, o);
  let body = null;
  const text = await r.text();
  if(text){ try { body = JSON.parse(text); } catch(e){ body = { raw:text }; } }
  if(!r.ok){ throw new Error((body && body.error) || ("HTTP "+r.status)); }
  if(body && body.error){ throw new Error(body.error); }
  return body;
}

// Wrap an async click handler so failures always toast and the button can't be
// double-fired while in flight.
function action(btn, fn, busyLabel){
  return async function(){
    const orig = btn.innerHTML;
    btn.disabled = true;
    if(busyLabel) btn.innerHTML = '<span class="spin"></span> '+busyLabel;
    try { await fn(); }
    catch(e){ toast(e.message || String(e), 'err'); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  };
}

const el = (h) => {
  const d=document.createElement('div');
  const t=h.trim();
  if(t.startsWith('<tr') || t.startsWith('<td')){
    const tbl=document.createElement('table');
    tbl.innerHTML=h;
    return tbl.querySelector('tr') || tbl.querySelector('td') || d;
  }
  d.innerHTML=h;
  return d.firstElementChild;
};
function riskClass(r){ return "risk"+r; }
function esc(s){ return String(s==null?"":s).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

function renderNav(){
  const nav=document.getElementById('nav'); nav.innerHTML='';
  for(const t of TABS){
    const label = (t==='Approvals' && pendingApprovals>0) ? (t+'<span class="navbadge">'+pendingApprovals+'</span>') : t;
    const b=el('<button>'+label+'</button>');
    if(t===current)b.className='active';
    b.onclick=()=>{current=t;renderNav();render();};
    nav.appendChild(b);
  }
}

async function render(){
  clearLogTimers();
  const m=document.getElementById('main');
  const hash=window.location.hash;
  if(hash.startsWith('#oauth/approve')){
    const nav=document.getElementById('nav'); if(nav)nav.style.display='none';
    await renderOAuthApprove(m);
    return;
  }
  const nav=document.getElementById('nav'); if(nav)nav.style.display='block';
  m.innerHTML='<p class="muted">Loading…</p>';
  try { await VIEWS[current](m); } catch(e){ m.innerHTML='<div class="card">Error: '+esc(e.message)+'</div>'; }
}

async function renderOAuthApprove(m){
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  const params = new URLSearchParams(qIdx !== -1 ? hash.slice(qIdx) : '');
  const state = params.get('state') || '';
  const redirectUri = params.get('redirect_uri') || '';

  m.innerHTML = '<div class="card" style="max-width:500px;margin:40px auto;padding:24px;">'
    +'<h2 style="margin-top:0;">Approve ChatGPT Connection</h2>'
    +'<p>ChatGPT wants to connect to your LocalAnt instance.</p>'
    +'<p class="muted" style="word-break:break-all;font-size:12px;background:var(--panel2);padding:10px;border-radius:8px;">Redirect URI: <code>'+esc(redirectUri)+'</code></p>'
    +'<div class="row" style="margin-top:24px;gap:12px;display:flex;">'
      +'<button class="btn ok" id="oauthApproveBtn" style="flex:1;padding:12px;">Approve &amp; Connect</button>'
      +'<button class="btn danger" id="oauthDenyBtn" style="flex:1;padding:12px;background:none;border:1px solid var(--danger);color:var(--danger)">Deny</button>'
    +'</div>'
    +'<div id="oauthErr" class="muted" style="margin-top:12px;color:var(--danger)"></div>'
    +'</div>';

  document.getElementById('oauthApproveBtn').onclick = async () => {
    try {
      const res = await api('oauth/approve', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ redirect_uri: redirectUri })
      });
      const target = redirectUri + (redirectUri.includes('?') ? '&' : '?') + 'code=' + res.code + '&state=' + encodeURIComponent(state);
      window.location.href = target;
    } catch(e) {
      document.getElementById('oauthErr').textContent = e.message;
    }
  };

  document.getElementById('oauthDenyBtn').onclick = () => {
    window.location.href = redirectUri + (redirectUri.includes('?') ? '&' : '?') + 'error=access_denied&state=' + encodeURIComponent(state);
  };
}

function tunnelControls(t){
  let regLink = '';
  let errMsg = t.error || '';
  if (t.error && t.error.indexOf('https://console.serveo.net') !== -1) {
    const m = t.error.match(/https:\\/\\/console\\.serveo\\.net\\/ssh\\/keys\\?add=[^\\s]+/i);
    if (m) {
      const url = m[0];
      regLink = '<div class="warnbox" style="border-color:var(--accent);background:rgba(79,140,255,0.1);color:#cce0ff">'
        + '🔑 <b>Action Required</b>: SSH key registration is required to use the serveo tunnel.<br>'
        + '<a href="' + esc(url) + '" target="_blank" class="btn sm" style="display:inline-block;margin-top:8px;text-decoration:none;background:var(--accent);color:#fff">Register Key on Serveo</a>'
        + '</div>';
      errMsg = t.error.replace(url, '').replace(/Please register here:\\s*$/, '');
    }
  }

  const card=el('<div class="card"><h2>Tunnel</h2>'
    + (regLink || '')
    + '<p>Provider: <code>'+esc(t.provider)+'</code> · Status: <code>'+esc(t.status)+'</code></p>'
    + (t.url?'<p>URL: <code>'+esc(t.url)+'</code></p>':'<p class="muted">No public URL.</p>')
    + (errMsg?'<p class="risk4">'+esc(errMsg)+'</p>':'')
    + '<div class="row"><button class="btn" id="tunStart">Start</button>'
    + '<button class="btn ghost" id="tunRestart">Restart</button>'
    + '<button class="btn danger" id="tunStop">Stop</button></div></div>');
  card.querySelector('#tunStart').onclick=action(card.querySelector('#tunStart'),async()=>{ await api('tunnel/start',{method:'POST'}); toast('Tunnel starting'); render(); },'Starting');
  card.querySelector('#tunRestart').onclick=action(card.querySelector('#tunRestart'),async()=>{ await api('tunnel/restart',{method:'POST'}); toast('Tunnel restarted'); render(); },'Restarting');
  card.querySelector('#tunStop').onclick=action(card.querySelector('#tunStop'),async()=>{ await api('tunnel/stop',{method:'POST'}); toast('Tunnel stopped'); render(); });
  return card;
}

const VIEWS = {
  async Home(m){
    const s=await api('status');
    const mcp=await api('mcp-endpoint');
    m.innerHTML='';
    const t=s.tunnel||{};
    const endpoint = mcp.endpoint || '(tunnel not running — start it below or from the CLI)';
    m.appendChild(el('<div class="card"><h2>Gateway</h2>'
      +'<p><b>LocalAnt Version:</b> <code>v'+esc(s.version)+'</code></p>'
      +'<div class="row"><span class="tag">'+esc(s.platform)+'</span><span class="tag">node '+esc(s.node)+'</span><span class="tag">pid '+s.pid+'</span></div>'
      +'<p class="muted">Started '+esc(s.startedAt)+'</p>'
      +'<p>Gateway: <code>'+esc(s.gateway)+'</code></p>'
      +'<p>Dashboard: <code>'+esc(s.dashboard||'')+'</code></p></div>'));

    if(t.url && /trycloudflare\\.com/.test(t.url)){
      m.appendChild(el('<div class="warnbox">⚠️ This is a temporary Quick Tunnel URL — it <b>changes every restart</b>, so you would have to recreate the ChatGPT connector each time. To get a permanent URL (and never rebuild the connector), set a fixed tunnel in <b>Settings</b> (ngrok static domain, a custom subdomain, or your own domain). The auth token is persistent, so a fixed URL means no re-auth.</div>'));
    }

    const card=el('<div class="card"><h2>ChatGPT MCP endpoint</h2>'
      +'<pre id="ep">'+esc(endpoint)+'</pre>'
      +'<div class="row"><button class="btn" id="copyEp">Copy</button><button class="btn ghost" id="testEp">Test connection</button><span id="testOut" class="muted" style="font-size:12px"></span></div>'
      +'<ol class="muted"><li>Open <a href="https://chatgpt.com/#settings/Connectors" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;">ChatGPT Connectors Settings</a></li><li><a href="https://chatgpt.com/#settings/Connectors/Advanced" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;">Advanced settings</a> → Developer Mode ON</li><li>Connectors → Create</li><li>Paste the URL above, name it LocalAnt</li><li>Set Authentication to "None" (the token is embedded in the URL)</li><li>Ask ChatGPT: "Run health check on my local app"</li></ol></div>');
    m.appendChild(card);
    document.getElementById('copyEp').onclick=()=>{ navigator.clipboard.writeText(endpoint); toast('Copied endpoint'); };
    const testBtn=document.getElementById('testEp');
    testBtn.onclick=action(testBtn,async()=>{
      const out=document.getElementById('testOut');
      out.textContent='';
      const r=await api('tunnel/test',{method:'POST'});
      if(r.reachable){ out.innerHTML='<span class="risk0">✓ reachable ('+r.status+', '+r.ms+'ms) — ChatGPT can reach your gateway.</span>'; }
      else { out.innerHTML='<span class="risk4">✗ not reachable'+(r.reason?': '+esc(r.reason):'')+'</span>'; }
    },'Testing');

    m.appendChild(tunnelControls(t));

    const hc=el('<div class="card"><h2>Health check</h2><button class="btn ghost" id="hcBtn">Run</button><pre id="hcOut" style="display:none"></pre></div>');
    m.appendChild(hc);
    document.getElementById('hcBtn').onclick=action(document.getElementById('hcBtn'),async()=>{ const o=document.getElementById('hcOut'); o.style.display='block'; o.textContent=JSON.stringify(await api('health'),null,2); });

    const env=el('<div class="card"><h2>Environment</h2><div id="envOut" class="muted">Checking…</div></div>');
    m.appendChild(env);
    try {
      const d=await api('doctor');
      const chips=d.tools.map(function(t){ return '<span class="tag" style="margin:2px;'+(t.available?'':'opacity:.5')+'">'+(t.available?'✓':'✗')+' '+esc(t.name)+'</span>'; }).join(' ');
      document.getElementById('envOut').innerHTML='<p>node '+esc(d.node)+' · '+esc(d.platform)+(d.skillExecOk?'':' <span class="risk2">(Node 22+ recommended for skills)</span>')+'</p><div class="row">'+chips+'</div><p class="muted" style="font-size:12px;margin-top:8px">✓ = on PATH. Install <code>tailscale</code> for the default Funnel tunnel, or <code>cloudflared</code>/<code>ngrok</code> as fallbacks, <code>claude</code>/<code>codex</code>/<code>openclaw</code>/<code>agy</code>/<code>hermes</code>/<code>opencode</code> for agents.</p>';
    } catch(e){ document.getElementById('envOut').textContent='Could not load environment.'; }
  },

  async Security(m){
    const c=await api('config');
    m.innerHTML='';
    const t=c.tunnel||{};
    if(t.provider && t.provider!=='none'){ m.appendChild(el('<div class="warnbox">⚠️ A public tunnel exposes this gateway to the internet. Anyone with the URL + token can reach your tools. Keep the token secret and stop the tunnel when not in use.</div>')); }
    const modeNote = { strict:'allow-list: only allowed dirs/commands, per-risk approval', open:'deny-list: everything except the blocklist; only risk-4 needs approval', yolo:'deny-list with no approval gates at all' };
    m.appendChild(el('<div class="card"><h2>Security mode</h2><p><code>'+esc(c.security.mode)+'</code> — '+esc(modeNote[c.security.mode]||'')+'</p><p class="muted">Change it in Settings.</p></div>'));
    m.appendChild(el('<div class="card"><h2>Allowed directories <span class="muted">(strict mode only)</span></h2><pre>'+esc(JSON.stringify(c.security.allowedDirectories,null,2))+'</pre></div>'));
    m.appendChild(el('<div class="card"><h2>Allowed commands <span class="muted">(strict mode only)</span></h2><pre>'+esc(JSON.stringify(c.security.allowedCommands,null,2))+'</pre></div>'));
    m.appendChild(el('<div class="card"><h2>Blocked command tokens <span class="muted">(always enforced)</span></h2><pre>'+esc(JSON.stringify(c.security.blockedCommandTokens,null,2))+'</pre></div>'));
    m.appendChild(el('<div class="card"><h2>Risk policy</h2><p class="muted">risk 0 read-only · 1 draft · 2 file-mod · 3 shell/agent · 4 destructive/publish</p><p>approveRisk1: <code>'+c.security.approveRisk1+'</code></p></div>'));
  },

  async Approvals(m){
    const list=await api('approvals');
    m.innerHTML='<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Pending approvals <span class="tag" id="apCount">'+list.length+'</span></h2><div class="row" id="apBulk"></div></div><div id="ap"></div></div>';
    const ap=document.getElementById('ap');
    if(!list.length){ ap.innerHTML='<p class="muted">No pending approvals.</p>'; return; }
    // Bulk actions — handy on mobile when several requests queue up at once.
    if(list.length>1){
      const bulk=document.getElementById('apBulk');
      const allOnce=el('<button class="btn ok sm">Approve all</button>');
      const allDeny=el('<button class="btn danger sm">Deny all</button>');
      allOnce.onclick=action(allOnce,async()=>{await api('approvals/approve-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'once'})});render();});
      allDeny.onclick=action(allDeny,async()=>{if(confirm('Deny all '+list.length+' pending approvals?')){await api('approvals/deny-all',{method:'POST'});render();}});
      bulk.appendChild(allOnce); bulk.appendChild(allDeny);
    }
    for(const a of list){
      const d=el('<div class="card approval" style="background:var(--panel2)"><div class="row"><b>'+esc(a.tool)+'</b> <span class="tag '+riskClass(a.risk)+'">risk '+a.risk+'</span> <span class="tag">'+esc(a.requirement)+'</span></div>'
        +'<p class="muted">'+esc(a.summary)+'</p><p class="muted">'+esc(a.reason)+'</p>'
        +'<div class="row approval-actions"><button class="btn ok">Approve once</button><button class="btn">Approve for session</button><button class="btn danger">Deny</button></div></div>');
      const [once,sess,deny]=d.querySelectorAll('.approval-actions button');
      once.onclick=action(once,async()=>{await api('approvals/'+a.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'once'})});render();});
      sess.onclick=action(sess,async()=>{await api('approvals/'+a.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'session'})});render();});
      deny.onclick=action(deny,async()=>{await api('approvals/'+a.id+'/deny',{method:'POST'});render();});
      ap.appendChild(d);
    }
  },

  async Audit(m){
    m.innerHTML='<div class="card"><h2>Audit log</h2>'
      +'<div class="row" style="margin-bottom:12px;gap:8px"><input type="text" id="auditQ" placeholder="Search tool / input / output…" style="flex:1;min-width:200px" /><button class="btn ghost" id="auditSearch">Search</button><button class="btn ghost" id="auditClear">Clear</button></div>'
      +'<p class="muted" style="margin-top:0;font-size:12px">Click a row for the full entry.</p>'
      +'<table><thead><tr><th>Time</th><th>Tool</th><th>Risk</th><th>Approval</th><th>ms</th><th>In</th></tr></thead><tbody id="lg"></tbody></table></div>';
    const tb=document.getElementById('lg');
    const load=async(q)=>{
      tb.innerHTML='';
      const logs=await api('audit'+(q?('?q='+encodeURIComponent(q)):''));
      if(!logs.length){ tb.appendChild(el('<tr><td colspan=6 class="muted">'+(q?'No matches.':'No audit entries yet.')+'</td></tr>')); return; }
      for(const e of logs){
        const tr=el('<tr style="cursor:pointer"><td class="muted">'+esc(e.timestamp.replace("T"," ").slice(0,19))+'</td><td>'+esc(e.tool)+'</td><td class="'+riskClass(e.risk)+'">'+e.risk+'</td><td>'+esc(e.approval)+(e.error?' <span class="risk4">err</span>':'')+'</td><td>'+e.durationMs+'</td><td class="muted">'+esc(String(e.inputSummary).slice(0,80))+'</td></tr>');
        tr.onclick=()=>showAuditDetail(e.id);
        tb.appendChild(tr);
      }
    };
    document.getElementById('auditSearch').onclick=action(document.getElementById('auditSearch'),async()=>{ await load(document.getElementById('auditQ').value.trim()); });
    document.getElementById('auditClear').onclick=async()=>{ document.getElementById('auditQ').value=''; await load(''); };
    document.getElementById('auditQ').addEventListener('keydown',(ev)=>{ if(ev.key==='Enter') document.getElementById('auditSearch').click(); });
    await load('');
  },

  async Skills(m){
    const data=await api('skills');
    const skills=data.skills||[];
    m.innerHTML='<div class="card"><h2>Skills</h2>'
      +'<p class="muted">Drop skills into <code>'+esc(data.skillsDir||'')+'</code> or create one below. Generated skills start disabled.</p>'
      +'<table><thead><tr><th>Name</th><th>Ver</th><th>Risk</th><th>State</th><th>Tools</th><th></th></tr></thead><tbody id="sk"></tbody></table></div>'
      +'<div class="card"><h2>Create skill</h2>'
        +'<div class="row" style="gap:12px;">'
          +'<input type="text" id="skName" placeholder="name (kebab-case)" style="width:200px" />'
          +'<input type="text" id="skDesc" placeholder="description" style="flex:1;min-width:200px" />'
          +'<select id="skRisk" style="width:90px"><option value="0">risk 0</option><option value="1" selected>risk 1</option><option value="2">risk 2</option><option value="3">risk 3</option><option value="4">risk 4</option></select>'
          +'<button class="btn" id="skCreate">Create</button>'
        +'</div><p class="muted" style="margin-top:8px;">The generated skill is saved <b>disabled</b>. Review its permissions, then enable it.</p></div>'
      +'<div class="card"><h2>Install from Git</h2>'
        +'<div class="row" style="gap:12px;">'
          +'<input type="text" id="skUrl" placeholder="https://github.com/user/my-skill.git" style="flex:1;min-width:240px" />'
          +'<button class="btn" id="skInstall">Clone</button>'
        +'</div><p class="muted" style="margin-top:8px;">Clones the repo into the skills directory <b>disabled</b>. Only install skills you trust — review permissions before enabling.</p></div>';
    const tb=document.getElementById('sk');
    if(!skills.length){ tb.appendChild(el('<tr><td colspan=6 class="muted">No skills found.</td></tr>')); }
    for(const s of skills){
      const tr=el('<tr><td><b>'+esc(s.name)+'</b>'+(s.generated?' <span class="tag">generated</span>':'')+(s.bundled?' <span class="tag">bundled</span>':'')+'<br><span class="muted">'+esc(s.description)+'</span></td><td>'+esc(s.version)+'</td><td class="'+riskClass(s.riskLevel)+'">'+s.riskLevel+'</td><td>'+(s.enabled?'<span class="risk0">enabled</span>':'<span class="muted">disabled</span>')+(s.valid?'':' <span class="risk4">invalid</span>')+'</td><td class="muted">'+esc((s.tools||[]).join(", "))+'</td><td></td></tr>');
      const cell=tr.lastElementChild;
      const toggle=el('<button class="btn ghost sm">'+(s.enabled?'Disable':'Enable')+'</button>');
      toggle.onclick=action(toggle,async()=>{await api('skills/'+encodeURIComponent(s.name)+'/'+(s.enabled?'disable':'enable'),{method:'POST'});toast(s.name+(s.enabled?' disabled':' enabled'));render();});
      cell.appendChild(toggle);
      const info=el('<button class="btn ghost sm" style="margin-left:6px">Details</button>');
      info.onclick=action(info,async()=>{ await showSkillDetail(s.name); });
      cell.appendChild(info);
      if(!s.bundled){
        const un=el('<button class="btn danger sm" style="margin-left:6px;background:none;border:1px solid var(--danger);color:var(--danger)">Uninstall</button>');
        un.onclick=action(un,async()=>{ if(confirm('Uninstall skill "'+s.name+'"? This deletes its files.')){ await api('skills/'+encodeURIComponent(s.name),{method:'DELETE'}); toast(s.name+' uninstalled'); render(); } });
        cell.appendChild(un);
      }
      tb.appendChild(tr);
    }
    document.getElementById('skCreate').onclick=action(document.getElementById('skCreate'),async()=>{
      const name=document.getElementById('skName').value.trim();
      const description=document.getElementById('skDesc').value.trim();
      const riskLevel=parseInt(document.getElementById('skRisk').value,10);
      if(!name||!description){ toast('Name and description are required.','err'); return; }
      await api('skills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,description,riskLevel})});
      toast('Skill "'+name+'" created (disabled)');
      render();
    },'Creating');
    document.getElementById('skInstall').onclick=action(document.getElementById('skInstall'),async()=>{
      const url=document.getElementById('skUrl').value.trim();
      if(!url){ toast('Git URL is required.','err'); return; }
      const r=await api('skills/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
      toast('Installed "'+r.installed+'" (disabled)');
      render();
    },'Cloning');
  },

  async Secrets(m){
    const s=await api('secrets');
    m.innerHTML='<div class="card"><h2>Secrets</h2><p class="muted">Names only — values are never displayed.</p>'
      +'<ul id="sl" style="padding-left:20px;margin-bottom:24px;"></ul>'
      +'<h3>Add secret</h3>'
      +'<div class="row" style="margin-top:12px;gap:12px;">'
        +'<input type="text" id="secName" placeholder="Secret name (e.g. QIITA_TOKEN)" style="width:250px" />'
        +'<input type="password" id="secVal" placeholder="Secret value" style="width:220px" />'
        +'<button class="btn ghost sm" id="secValShow">Show</button>'
        +'<button class="btn" id="addSecBtn">Add secret</button>'
      +'</div></div>';
    wirePw('secVal','secValShow');
    const ul=document.getElementById('sl');
    if(!s.names.length) ul.appendChild(el('<li class="muted">No secrets stored.</li>'));
    for(const n of s.names){
      const li=el('<li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;"><code>'+esc(n)+'</code></li>');
      const rm=el('<button class="btn danger sm" style="background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>');
      rm.onclick=action(rm,async()=>{ if(confirm('Remove secret "'+n+'"?')){ await api('secrets/'+encodeURIComponent(n),{method:'DELETE'}); toast('Removed '+n); render(); } });
      li.appendChild(rm);
      ul.appendChild(li);
    }
    document.getElementById('addSecBtn').onclick=action(document.getElementById('addSecBtn'),async()=>{
      const name=document.getElementById('secName').value.trim();
      const value=document.getElementById('secVal').value.trim();
      if(!name||!value){ toast('Both name and value are required.','err'); return; }
      await api('secrets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,value})});
      toast('Secret added');
      render();
    });
  },

  // Dedicated Autopilot page: shows which provider actually runs (the resolved
  // chain with live availability), lets you configure the primary / fallback
  // chain / fallback policy, and runs a safe read-only test against a directory.
  async Autopilot(m){
    const d=await api('autopilot');
    const POLICY=[['onTimeout','Timeout'],['onNonZeroExit','Non-zero exit'],['onEmptyOutput','Empty output'],['onNoChanges','No changes'],['onRateLimit','Rate / usage limit'],['onCommandNotFound','Command not found'],['onAuthError','Auth / provider error'],['onSafetyBlock','Safety block (off by default)'],['onApprovalRequired','Approval required (off by default)']];
    const detail={}; (d.providersDetail||[]).forEach(function(p){ detail[p.id]=p; });
    const apIds=(d.providersDetail||[]).map(function(p){return p.id;});
    function lbl(id){ return (detail[id]&&detail[id].label)||id; }
    function availBadge(id){
      const p=detail[id]; if(!p) return '';
      if(!p.enabled) return '<span class="tag" style="opacity:.7">disabled</span>';
      if(!p.available) return '<span class="tag risk4">CLI not on PATH</span>';
      return '<span class="tag risk0">ready</span>';
    }

    if(!apIds.length){ m.innerHTML='<div class="card"><h2>Autopilot</h2><p class="muted">No coding agents are configured.</p></div>'; return; }

    var st={ primary:d.primary, fallbacks:(d.fallbacks||[]).slice(), providers:JSON.parse(JSON.stringify(d.providers||{})), fallbackPolicy:JSON.parse(JSON.stringify(d.fallbackPolicy||{})) };
    function enabled(id){ return !(st.providers[id]&&st.providers[id].enabled===false); }
    function save(){ return api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({autopilot:st})}); }
    function err(e){ toast(e.message,'err'); }

    m.innerHTML='<div class="card"><h2>What runs when ChatGPT calls <code>autopilot</code></h2>'
      +'<p class="muted" style="margin-top:0">ChatGPT delegates through one <code>autopilot</code> tool and never names a backend. LocalAnt tries the providers below <b>in order</b>, skipping any that are disabled or whose CLI is missing, and advances on failure per your fallback policy.</p>'
      +'<ol id="apChain" style="margin:0;padding-left:22px"></ol></div>'

      +'<div class="card"><h2>Primary provider</h2>'
      +'<p class="muted" style="margin-top:0">The first agent Autopilot tries.</p>'
      +'<select id="apPrimary" style="width:240px"></select></div>'

      +'<div class="card"><h2>Providers</h2>'
      +'<p class="muted" style="margin-top:0">Only enabled providers are eligible. A provider with no CLI on PATH stays installed but is skipped at run time — install its CLI to use it.</p>'
      +'<table><thead><tr><th>Provider</th><th>CLI</th><th>Enabled</th></tr></thead><tbody id="apProviders"></tbody></table></div>'

      +'<div class="card"><h2>Fallback chain</h2>'
      +'<p class="muted" style="margin-top:0">Tried top-to-bottom after the primary fails in a way the policy permits.</p>'
      +'<ul id="apFallbacks" style="padding-left:0;list-style:none;margin:0 0 8px"></ul>'
      +'<div class="row" style="gap:8px"><select id="apAddFb" style="width:220px"></select><button class="btn ghost sm" id="apAddFbBtn">Add to chain</button></div></div>'

      +'<div class="card"><h2>Fallback policy</h2>'
      +'<p class="muted" style="margin-top:0">Advance to the next provider when the current one fails because of…</p>'
      +'<div id="apPolicy"></div></div>'

      +'<div class="card"><h2>Test the chain <span class="muted">(read-only)</span></h2>'
      +'<p class="muted" style="margin-top:0">Runs the real provider chain in a non-mutating mode against a directory — no edits, no branch. Use it to confirm the configured agent answers.</p>'
      +'<div class="row" style="gap:12px;margin-bottom:8px"><input type="text" id="apTestCwd" placeholder="working directory (absolute path)" style="flex:1;min-width:240px" />'
      +'<select id="apTestMode"><option value="plan">plan</option><option value="review">review</option></select></div>'
      +'<textarea id="apTestTask" rows="2" placeholder="e.g. Summarize what this project does">Run a quick health check and summarize this project.</textarea>'
      +'<div class="row" style="margin-top:8px"><button class="btn" id="apTestBtn">Run test</button></div>'
      +'<div id="apTestOut" style="margin-top:12px"></div></div>';

    function paintChain(){
      const ol=document.getElementById('apChain'); if(!ol)return; ol.innerHTML='';
      const order=(d.order||[]);
      if(!order.length){ ol.outerHTML='<p class="risk4" id="apChain">No provider is enabled — enable one below or Autopilot will refuse to run.</p>'; return; }
      order.forEach(function(id){
        ol.appendChild(el('<li style="margin-bottom:4px"><code>'+esc(lbl(id))+'</code> '+availBadge(id)+(id===st.primary?' <span class="tag">primary</span>':'')+'</li>'));
      });
      const runnable=order.filter(function(id){ return detail[id]&&detail[id].available; });
      if(!runnable.length){ ol.appendChild(el('<li class="risk4">No provider in the chain has its CLI installed — Autopilot will fail until you install one.</li>')); }
    }
    async function refreshChain(){ try{ const nd=await api('autopilot'); d.order=nd.order; (nd.providersDetail||[]).forEach(function(p){detail[p.id]=p;}); paintChain(); paintProviders(); }catch(e){} }

    function paintPrimary(){
      const sel=document.getElementById('apPrimary'); if(!sel)return;
      sel.innerHTML=apIds.map(function(id){return '<option value="'+esc(id)+'"'+(st.primary===id?' selected':'')+'>'+esc(lbl(id))+'</option>';}).join('');
      sel.onchange=function(e){ st.primary=e.target.value; st.fallbacks=st.fallbacks.filter(function(x){return x!==st.primary;}); save().then(function(){ toast('Primary → '+lbl(st.primary)); paintFallbacks(); paintAdd(); refreshChain(); }).catch(err); };
    }
    function paintProviders(){
      const tb=document.getElementById('apProviders'); if(!tb)return; tb.innerHTML='';
      apIds.forEach(function(id){
        const p=detail[id]||{};
        const cli=p.available?'<span class="risk0">on PATH</span>':'<span class="risk4">missing</span>';
        const tr=el('<tr><td><b>'+esc(lbl(id))+'</b></td><td>'+cli+'</td><td></td></tr>');
        const wrap=el('<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox"'+(enabled(id)?' checked':'')+' style="width:auto"/> '+(enabled(id)?'enabled':'disabled')+'</label>');
        wrap.querySelector('input').onchange=function(e){ st.providers[id]={enabled:e.target.checked}; save().then(function(){ toast('Saved'); refreshChain(); }).catch(err); };
        tr.lastElementChild.appendChild(wrap);
        tb.appendChild(tr);
      });
    }
    function paintFallbacks(){
      const ul=document.getElementById('apFallbacks'); if(!ul)return; ul.innerHTML='';
      if(!st.fallbacks.length){ ul.innerHTML='<li class="muted">None — primary only.</li>'; return; }
      st.fallbacks.forEach(function(id,i){
        const li=el('<li style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="flex:1"><code>'+esc(lbl(id))+'</code> '+availBadge(id)+'</span></li>');
        const up=el('<button class="btn ghost sm">↑</button>'); up.disabled=i===0; up.onclick=function(){ const a=st.fallbacks,t=a[i-1]; a[i-1]=a[i]; a[i]=t; save().then(function(){paintFallbacks();refreshChain();}).catch(err); };
        const dn=el('<button class="btn ghost sm">↓</button>'); dn.disabled=i===st.fallbacks.length-1; dn.onclick=function(){ const a=st.fallbacks,t=a[i+1]; a[i+1]=a[i]; a[i]=t; save().then(function(){paintFallbacks();refreshChain();}).catch(err); };
        const rm=el('<button class="btn ghost sm">Remove</button>'); rm.onclick=function(){ st.fallbacks=st.fallbacks.filter(function(x){return x!==id;}); save().then(function(){paintFallbacks();paintAdd();refreshChain();}).catch(err); };
        li.appendChild(up); li.appendChild(dn); li.appendChild(rm); ul.appendChild(li);
      });
    }
    function paintAdd(){
      const sel=document.getElementById('apAddFb'); if(!sel)return;
      const avail=apIds.filter(function(id){return st.fallbacks.indexOf(id)===-1&&id!==st.primary;});
      sel.innerHTML=avail.map(function(id){return '<option value="'+esc(id)+'">'+esc(lbl(id))+'</option>';}).join('');
      sel.disabled=!avail.length;
      const btn=document.getElementById('apAddFbBtn'); if(btn)btn.disabled=!avail.length;
    }
    function paintPolicy(){
      const dv=document.getElementById('apPolicy'); if(!dv)return; dv.innerHTML='';
      POLICY.forEach(function(p){
        const def=!(p[0]==='onSafetyBlock'||p[0]==='onApprovalRequired');
        let val=st.fallbackPolicy[p[0]]; if(val===undefined)val=def;
        const lab=el('<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px"><input type="checkbox"'+(val?' checked':'')+' style="width:auto"/> '+esc(p[1])+'</label>');
        lab.querySelector('input').onchange=function(e){ st.fallbackPolicy[p[0]]=e.target.checked; save().then(function(){toast('Saved');}).catch(err); };
        dv.appendChild(lab);
      });
    }

    document.getElementById('apAddFbBtn').onclick=function(){ const sel=document.getElementById('apAddFb'); if(sel&&sel.value){ st.fallbacks.push(sel.value); save().then(function(){paintFallbacks();paintAdd();refreshChain();}).catch(err); } };

    const testBtn=document.getElementById('apTestBtn');
    testBtn.onclick=action(testBtn,async()=>{
      const cwd=document.getElementById('apTestCwd').value.trim();
      const task=document.getElementById('apTestTask').value.trim();
      const mode=document.getElementById('apTestMode').value;
      const out=document.getElementById('apTestOut');
      if(!cwd){ toast('Working directory is required.','err'); return; }
      if(!task){ toast('Describe a task to test.','err'); return; }
      out.innerHTML='<p class="muted"><span class="spin"></span> Running '+esc(mode)+'…</p>';
      const r=await api('autopilot/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cwd,task,mode})});
      const head=r.ok?'<span class="risk0">✓ A provider answered.</span>':(r.exhausted?'<span class="risk4">✗ Every provider failed.</span>':'<span class="risk4">✗ Stopped: '+esc(r.stoppedReason||'')+'</span>');
      out.innerHTML='<p>'+head+'</p>'
        +'<p class="muted" style="margin:6px 0 4px">Attempts (in order):</p><ul id="apAttempts" style="margin:0 0 8px;padding-left:20px"></ul>'
        +'<pre style="max-height:300px">'+esc((r.output||'(no output)').slice(0,4000))+'</pre>';
      const ul=document.getElementById('apAttempts');
      const list=(r.attempts||[]);
      if(!list.length){ ul.appendChild(el('<li class="muted">none</li>')); }
      list.forEach(function(a){
        const status=a.skipped?'<span class="tag">skipped</span>':(a.ok?'<span class="tag risk0">ok</span>':'<span class="tag risk4">failed</span>');
        const why=a.failureReason?(' <span class="muted">'+esc(a.failureReason)+(a.exitCode!=null?' (exit '+esc(String(a.exitCode))+')':'')+'</span>'):'';
        const li=el('<li><code>'+esc(a.providerLabel||a.providerId)+'</code> '+status+why+(a.note?' <span class="muted">'+esc(a.note)+'</span>':'')+'</li>');
        // Surface the failing provider's own output so the cause is visible —
        // previously only the winning provider's output survived.
        const log=((a.stderr||'')+((a.stderr&&a.stdout)?'\\n':'')+(a.stdout||'')).trim();
        if(!a.ok && !a.skipped && log){
          const logsBtn=el(' <button class="btn ghost sm" style="margin-left:6px">Logs</button>');
          logsBtn.onclick=function(){
            const nx=li.querySelector('pre');
            if(nx){ nx.remove(); return; }
            const pre=el('<pre style="max-height:240px;margin-top:6px"></pre>');
            pre.textContent=log;
            li.appendChild(pre);
          };
          li.appendChild(logsBtn);
        }
        ul.appendChild(li);
      });
    },'Testing');

    paintChain(); paintPrimary(); paintProviders(); paintFallbacks(); paintAdd(); paintPolicy();
  },

  async MCP(m){
    m.innerHTML='<div class="card"><h2>Bridged MCP servers</h2>'
      +'<p class="muted" style="margin-top:0">Connect downstream <b>stdio</b> MCP servers to LocalAnt. Their tools are proxied through the gateway (approval + audit pipeline). '
        +'ChatGPT uses them via <code>mcp_server_list_tools</code> to discover and <code>mcp_server_run_tool</code> to invoke — these are available even in the <b>minimal</b> tool profile.</p>'
      +'<table><thead><tr><th>Name</th><th>Command</th><th>Enabled</th><th></th></tr></thead><tbody id="mcpList"></tbody></table>'
      +'<h3>Add server</h3>'
      +'<div class="row" style="gap:12px">'
        +'<input type="text" id="mcpName" placeholder="name (e.g. filesystem)" style="width:160px" />'
        +'<input type="text" id="mcpCmd" placeholder="command (e.g. npx)" style="width:150px" />'
        +'<input type="text" id="mcpArgs" placeholder="args (space-separated)" style="flex:1;min-width:180px" />'
        +'<button class="btn" id="mcpAdd">Add</button>'
      +'</div>'
      +'<p class="muted" style="margin-top:8px;font-size:12px">Example — official filesystem server: command <code>npx</code>, args <code>-y @modelcontextprotocol/server-filesystem /path/to/dir</code>. Use <b>Test</b> to verify the connection and list its tools.</p>'
      +'</div>';

    const mcpServers=await api('mcp-servers');
    const mcpList=document.getElementById('mcpList');
    if(!mcpServers.length) mcpList.appendChild(el('<tr><td colspan=4 class="muted">No MCP servers configured. Add one below.</td></tr>'));
    for(const sv of mcpServers){
      const tr=el('<tr><td><b>'+esc(sv.name)+'</b></td><td class="muted"><code>'+esc(sv.command)+' '+esc((sv.args||[]).join(" "))+'</code></td><td>'+(sv.enabled?'<span class="risk0">yes</span>':'<span class="muted">no</span>')+'</td><td></td></tr>');
      const cell=tr.lastElementChild;
      const tog=el('<button class="btn ghost sm">'+(sv.enabled?'Disable':'Enable')+'</button>');
      tog.onclick=action(tog,async()=>{ await api('mcp-servers/'+encodeURIComponent(sv.name)+'/'+(sv.enabled?'disable':'enable'),{method:'POST'}); render(); });
      cell.appendChild(tog);
      const test=el('<button class="btn ghost sm" style="margin-left:6px">Test</button>');
      test.onclick=action(test,async()=>{ const r=await api('mcp-servers/'+encodeURIComponent(sv.name)+'/test',{method:'POST'}); if(r.ok){ toast(sv.name+': '+r.tools.length+' tools ('+r.tools.slice(0,5).join(', ')+')'); } else { toast(sv.name+': '+r.reason,'err'); } },'Testing');
      cell.appendChild(test);
      const rm=el('<button class="btn danger sm" style="margin-left:6px;background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>');
      rm.onclick=action(rm,async()=>{ if(confirm('Remove MCP server "'+sv.name+'"?')){ await api('mcp-servers/'+encodeURIComponent(sv.name),{method:'DELETE'}); render(); } });
      cell.appendChild(rm);
      mcpList.appendChild(tr);
    }
    document.getElementById('mcpAdd').onclick=action(document.getElementById('mcpAdd'),async()=>{
      const name=document.getElementById('mcpName').value.trim();
      const command=document.getElementById('mcpCmd').value.trim();
      const args=document.getElementById('mcpArgs').value.trim();
      if(!name||!command){ toast('Name and command are required.','err'); return; }
      await api('mcp-servers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,command,args,enabled:true})});
      toast('MCP server added');
      render();
    });
  },

  async Settings(m){
    const [c, s]=await Promise.all([api('config'), api('status').catch(()=>({}))]);
    const sec=c.security||{};
    const mode=sec.mode||'open';
    const allowedDirs=sec.allowedDirectories||[];
    const allowedCmds=sec.allowedCommands||[];
    const blockedTokens=sec.blockedCommandTokens||[];
    const CORE=["sudo","su","mkfs","mkfs.ext4","dd","fdisk","diskutil","shutdown","reboot"];

    const tun=c.tunnel||{};

    let infoHtml = '';
    if (s && s.version) {
      infoHtml = '<div class="card"><h2>System Info</h2>'
        +'<p><b>LocalAnt Version:</b> <code>v'+esc(s.version)+'</code></p>'
        +'</div>';
    }

    m.innerHTML=infoHtml+'<div class="card"><h2>Security settings</h2>'
      +'<div class="field"><label>Security mode</label>'
        +'<select id="secMode" style="width:160px">'
          +'<option value="open"'+(mode==='open'?' selected':'')+'>open (default)</option>'
          +'<option value="strict"'+(mode==='strict'?' selected':'')+'>strict</option>'
          +'<option value="yolo"'+(mode==='yolo'?' selected':'')+'>yolo</option>'
        +'</select>'
        +'<p class="muted" style="margin-top:6px;font-size:12px;"><b>open</b>: deny-list for personal use — anything except the blocklist; only risk-4 needs approval. <b>strict</b>: allow-list + per-risk approval (shared machines). <b>yolo</b>: no approval gates at all.</p>'
      +'</div>'
      +'<div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="approveRisk1"'+(sec.approveRisk1?' checked':'')+' style="width:auto"/> Require approval for Risk 1 (draft) actions</label></div>'
      +'<div class="field"><label>Tool profile</label>'
        +'<select id="toolProfile" style="width:160px">'
          +'<option value="minimal"'+(((c.tools&&c.tools.profile)||'minimal')==='minimal'?' selected':'')+'>minimal (default)</option>'
          +'<option value="coding"'+((c.tools&&c.tools.profile)==='coding'?' selected':'')+'>coding</option>'
          +'<option value="full"'+((c.tools&&c.tools.profile)==='full'?' selected':'')+'>full</option>'
        +'</select>'
        +'<p class="muted" style="margin-top:6px;font-size:12px;"><b>minimal</b>: advertise only the core surface to ChatGPT — Shell, coding Agent, Skill, read-only files, and the control plane. <b>coding</b>: use ChatGPT as a local coding agent — read/edit/apply_patch, grep/glob, bash, git, project validation, todo/plan, agent delegation. <b>full</b>: advertise every tool (browser, adb, git, publishers, file writes, …).</p>'
      +'</div>'
      +'</div>'

      +'<div class="card"><h2>Autopilot</h2>'
      +'<p class="muted" style="margin-top:0">ChatGPT delegates local work through the single <code>autopilot</code> tool — it never names a backend. Pick which agent runs, the fallback chain, and run a safe test from the dedicated <b>Autopilot</b> tab.</p>'
      +'<button class="btn ghost sm" id="goAutopilot">Open Autopilot settings →</button>'
      +'</div>'

      +'<div class="card"><h2>Auth token</h2>'
      +'<p class="muted" style="margin-top:0">The token authenticates ChatGPT (it is embedded in the MCP URL). Keep it secret.</p>'
      +'<div class="row" style="gap:8px"><input type="password" id="authTok" value="" placeholder="•••••••• (click Reveal)" readonly style="flex:1" /><button class="btn ghost sm" id="authReveal">Reveal</button><button class="btn ghost sm" id="authCopy">Copy</button></div>'
      +'<p class="muted" style="margin-top:8px;font-size:12px">Rotating the token immediately invalidates the old MCP URL — you must update the URL in the ChatGPT connector (or just re-paste the new one shown on Home). Existing stored secrets are unaffected.</p>'
      +'<button class="btn danger" id="authRotate" style="margin-top:4px">Rotate token</button>'
      +'</div>'

      +'<div class="card"><h2>Tunnel — fixed URL</h2>'
      +'<p class="muted" style="margin-top:0">A fixed URL means you never recreate the ChatGPT connector. Pick a provider and fill the matching field, then Save &amp; restart.</p>'
      +'<div class="field"><label>Provider</label>'
        +'<select id="tunProvider" style="width:160px">'
          +['tailscale','cloudflared','ngrok','localtunnel','serveo','none'].map(function(p){return '<option value="'+p+'"'+((tun.provider||'tailscale')===p?' selected':'')+'>'+p+'</option>';}).join('')
        +'</select></div>'
      +'<div class="field"><label>Custom subdomain (localtunnel: no signup · serveo: one-time SSH key registration for a fixed URL)</label><input type="text" id="tunSubdomain" value="'+esc(tun.subdomain||'')+'" placeholder="e.g. my-localant-mcp" /></div>'
      +'<div class="field"><label>Token / authtoken (cloudflared tunnel token / ngrok authtoken)</label><div class="row" style="gap:8px"><input type="password" id="tunToken" value="'+esc(tun.token||'')+'" placeholder="Cloudflare Tunnel token or ngrok authtoken" style="flex:1" /><button class="btn ghost sm" id="tunTokenShow">Show</button></div></div>'
      +'<div class="field"><label>Custom domain (Tailscale Funnel FQDN / ngrok static domain)</label><input type="text" id="tunDomain" value="'+esc(tun.domain||'')+'" placeholder="e.g. my-mac.example-tailnet.ts.net or my-app.ngrok-free.app" /></div>'
      +'<div class="field"><label>Public URL (override — used as-is)</label><input type="text" id="tunUrl" value="'+esc(tun.publicUrl||'')+'" placeholder="e.g. https://my-domain.com" /></div>'
      +'<div class="row"><button class="btn" id="saveTunBtn">Save tunnel settings</button><button class="btn ghost" id="saveRestartBtn">Save &amp; restart tunnel</button></div>'
      +'</div>'

      +'<div class="card"><h2>Ports</h2>'
      +'<div class="row" style="gap:12px;">'
        +'<div class="field" style="margin:0"><label>Gateway port</label><input type="number" id="gwPort" value="'+(c.gateway&&c.gateway.port||8787)+'" style="width:120px"/></div>'
        +'<div class="field" style="margin:0"><label>Dashboard port</label><input type="number" id="dashPort" value="'+(c.dashboard&&c.dashboard.port||8788)+'" style="width:120px"/></div>'
        +'<button class="btn" id="savePorts" style="align-self:flex-end">Save ports</button>'
      +'</div><p class="muted" style="margin-top:8px">Takes effect after restarting the gateway process.</p></div>'

      +'<div class="card"><h2>Allowed directories <span class="muted">(strict mode)</span></h2><ul id="dirList" style="padding-left:20px;margin-bottom:16px;"></ul>'
        +'<div class="row" style="gap:12px;"><input type="text" id="newDir" placeholder="Absolute directory path" style="flex:1;" /><button class="btn" id="addDirBtn">Add</button></div></div>'

      +'<div class="card"><h2>Allowed commands <span class="muted">(strict mode)</span></h2><ul id="cmdList" style="padding-left:20px;margin-bottom:16px;"></ul>'
        +'<div class="row" style="gap:12px;"><input type="text" id="newCmd" placeholder="Command prefix (e.g. npm run)" style="flex:1;" /><button class="btn" id="addCmdBtn">Add</button></div></div>'

      +'<div class="card"><h2>Blocked command tokens <span class="muted">(always enforced)</span></h2><ul id="tokList" style="padding-left:20px;margin-bottom:16px;"></ul>'
        +'<div class="row" style="gap:12px;"><input type="text" id="newTok" placeholder="Token (e.g. nc)" style="flex:1;" /><button class="btn" id="addTokBtn">Add</button></div></div>'

      +'<div class="card"><h2>Raw config (advanced)</h2><p class="muted" style="margin-top:0">Edit the full JSON and save. Invalid config is rejected with the validation error.</p>'
        +'<textarea id="rawCfg" rows="16">'+esc(JSON.stringify(c,null,2))+'</textarea>'
        +'<div class="row" style="margin-top:8px"><button class="btn" id="saveRaw">Validate &amp; save</button></div></div>';

    wirePw('tunToken','tunTokenShow');
    const saveSec = async (update) => { await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({security:update})}); };
    const saveTun = async (update) => { await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tunnel:update})}); };

    document.getElementById('secMode').onchange=async(e)=>{ try{ await saveSec({mode:e.target.value}); toast('Mode → '+e.target.value); render(); }catch(err){ toast(err.message,'err'); } };
    document.getElementById('approveRisk1').onchange=async(e)=>{ try{ await saveSec({approveRisk1:e.target.checked}); toast('Saved'); }catch(err){ toast(err.message,'err'); } };
    document.getElementById('toolProfile').onchange=async(e)=>{ try{ await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tools:{profile:e.target.value}})}); toast('Tool profile → '+e.target.value); render(); }catch(err){ toast(err.message,'err'); } };

    document.getElementById('goAutopilot').onclick=function(){ current='Autopilot'; renderNav(); render(); };

    const authTok=document.getElementById('authTok');
    document.getElementById('authReveal').onclick=action(document.getElementById('authReveal'),async()=>{
      if(authTok.type==='text' && authTok.value){ authTok.type='password'; document.getElementById('authReveal').textContent='Reveal'; return; }
      const r=await api('token'); authTok.value=r.token; authTok.type='text'; document.getElementById('authReveal').textContent='Hide';
    });
    document.getElementById('authCopy').onclick=action(document.getElementById('authCopy'),async()=>{ const r=await api('token'); navigator.clipboard.writeText(r.token); toast('Token copied'); });
    document.getElementById('authRotate').onclick=action(document.getElementById('authRotate'),async()=>{
      if(!confirm('Rotate the auth token? The current MCP URL stops working until you update it in ChatGPT.')) return;
      const r=await api('token/rotate',{method:'POST'});
      authTok.value=r.token; authTok.type='text'; document.getElementById('authReveal').textContent='Hide';
      toast('Token rotated — update the connector URL (see Home)');
    });

    document.getElementById('tunProvider').onchange=async(e)=>{ try{ await saveTun({provider:e.target.value}); toast('Provider → '+e.target.value); }catch(err){ toast(err.message,'err'); } };

    function tunPayload(){
      return {
        token: document.getElementById('tunToken').value.trim(),
        domain: document.getElementById('tunDomain').value.trim(),
        publicUrl: document.getElementById('tunUrl').value.trim(),
        subdomain: document.getElementById('tunSubdomain').value.trim(),
        provider: document.getElementById('tunProvider').value
      };
    }
    document.getElementById('saveTunBtn').onclick=action(document.getElementById('saveTunBtn'),async()=>{ await saveTun(tunPayload()); toast('Tunnel settings saved'); });
    document.getElementById('saveRestartBtn').onclick=action(document.getElementById('saveRestartBtn'),async()=>{ await saveTun(tunPayload()); const info=await api('tunnel/restart',{method:'POST'}); toast(info.url?('Tunnel up: '+info.url):('Tunnel '+info.status)); },'Restarting');

    document.getElementById('savePorts').onclick=action(document.getElementById('savePorts'),async()=>{
      const gp=parseInt(document.getElementById('gwPort').value,10);
      const dp=parseInt(document.getElementById('dashPort').value,10);
      await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gateway:{host:(c.gateway&&c.gateway.host)||'127.0.0.1',port:gp},dashboard:{enabled:(c.dashboard?c.dashboard.enabled:true),port:dp}})});
      toast('Ports saved — restart the gateway to apply');
    });

    const listEditor = (ulId, items, key, opts) => {
      opts=opts||{};
      const ul=document.getElementById(ulId);
      if(!items.length) ul.innerHTML='<li class="muted">None.</li>';
      items.forEach(function(v){
        const isCore = opts.core && opts.core.indexOf(v)!==-1;
        const li=el('<li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;"><code>'+esc(v)+'</code>'+(isCore?' <span class="tag core">core</span>':'')+'</li>');
        if(!isCore){
          const rm=el('<button class="btn danger sm" style="background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>');
          rm.onclick=action(rm,async()=>{ await saveSec({[key]: items.filter(x=>x!==v)}); render(); });
          li.appendChild(rm);
        }
        ul.appendChild(li);
      });
    };
    listEditor('dirList', allowedDirs, 'allowedDirectories');
    listEditor('cmdList', allowedCmds, 'allowedCommands');
    listEditor('tokList', blockedTokens, 'blockedCommandTokens', { core: CORE });

    document.getElementById('addDirBtn').onclick=action(document.getElementById('addDirBtn'),async()=>{ const v=document.getElementById('newDir').value.trim(); if(v){ await saveSec({allowedDirectories:[...allowedDirs,v]}); render(); } });
    document.getElementById('addCmdBtn').onclick=action(document.getElementById('addCmdBtn'),async()=>{ const v=document.getElementById('newCmd').value.trim(); if(v){ await saveSec({allowedCommands:[...allowedCmds,v]}); render(); } });
    document.getElementById('addTokBtn').onclick=action(document.getElementById('addTokBtn'),async()=>{ const v=document.getElementById('newTok').value.trim(); if(v){ await saveSec({blockedCommandTokens:[...blockedTokens,v]}); render(); } });

    document.getElementById('saveRaw').onclick=action(document.getElementById('saveRaw'),async()=>{
      let parsed;
      try { parsed=JSON.parse(document.getElementById('rawCfg').value); }
      catch(e){ toast('Invalid JSON: '+e.message,'err'); return; }
      await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(parsed)});
      toast('Config saved');
      render();
    });
  },

  // One sidebar entry. Opening it shows three sub-tabs — built-in Tools, Skills,
  // and MCP — each rendered into the shared pane under the sub-tab bar. The
  // active sub-tab persists across re-renders (toolSub) so toggling a skill or
  // server keeps you in place.
  async Tools(m){
    m.innerHTML = '<div class="card" style="padding:10px 14px"><div class="row" id="toolSubtabs" style="gap:8px"></div></div><div id="toolPane"></div>';
    const bar = document.getElementById('toolSubtabs');
    const pane = document.getElementById('toolPane');
    const btns = {};
    const renderSub = async function(key){
      toolSub = key;
      for(const k in btns){ btns[k].className = 'btn '+(k===key?'':'ghost')+' sm'; }
      pane.innerHTML = '';
      if(key==='skills') await VIEWS.Skills(pane);
      else if(key==='mcp') await VIEWS.MCP(pane);
      else await builtinToolsView(pane);
    };
    for(const pair of [['tools','Tools'],['skills','Skills'],['mcp','MCP']]){
      const b = el('<button class="btn ghost sm">'+pair[1]+'</button>');
      b.onclick = function(){ renderSub(pair[0]); };
      btns[pair[0]] = b; bar.appendChild(b);
    }
    await renderSub(toolSub || 'tools');
  },
};

// Built-in tools ChatGPT can call right now (the active profile surface only).
async function builtinToolsView(m){
  const [tools, cfg] = await Promise.all([api('tools'), api('config')]);
  const profile = (cfg.tools && cfg.tools.profile) || 'minimal';
  const active = tools.filter(function(t){ return t.active; });
  const hidden = tools.length - active.length;
  m.innerHTML = '<div class="card"><h2>Built-in tools</h2>'
    + '<p class="muted" style="margin-top:0">Built-in tools ChatGPT can call right now — profile <code>'+esc(profile)+'</code> exposes <b>'+active.length+'</b>'+(hidden?' ('+hidden+' inactive tools hidden — switch to the <code>full</code> profile in Settings to expose them)':'')+'.</p>'
    + '<div class="row" style="gap:8px;margin-bottom:10px"><input type="text" id="toolSearch" placeholder="Search tools…" style="flex:1;min-width:200px" /></div>'
    + '<table><thead><tr><th>Name</th><th>Risk</th><th>Description</th><th>Parameters</th></tr></thead><tbody id="tl"></tbody></table>'
    + '<p class="muted" id="toolEmpty" style="display:none">No matching tools.</p>'
    + '</div>';
  const tb = document.getElementById('tl');
  const rowEls = [];
  if(!active.length){ tb.appendChild(el('<tr><td colspan=4 class="muted">No active tools in this profile.</td></tr>')); }
  for(const t of active){
    const params = Object.entries(t.inputSchema || {}).map(function(item){
      const info = item[1];
      const d = info.description ? (' - ' + esc(info.description)) : '';
      return '<code>' + esc(item[0]) + '</code>: <span class="muted">' + esc(info.type) + '</span>' + d;
    }).join('<br>') || '<span class="muted">none</span>';
    const tr = el('<tr><td><b>'+esc(t.name)+'</b></td><td class="'+riskClass(t.risk)+'">risk '+t.risk+'</td><td>'+esc(t.description)+'</td><td>'+params+'</td></tr>');
    tr._text = (t.name + ' ' + (t.description||'')).toLowerCase();
    rowEls.push(tr); tb.appendChild(tr);
  }
  document.getElementById('toolSearch').oninput=function(){
    const q=(this.value||'').toLowerCase().trim();
    let shown=0;
    for(const tr of rowEls){ const ok=!q||tr._text.indexOf(q)>=0; tr.style.display=ok?'':'none'; if(ok) shown++; }
    document.getElementById('toolEmpty').style.display=shown?'none':'';
  };
}

async function showAuditDetail(id){
  try {
    const e=await api('audit/'+encodeURIComponent(id));
    const row=(k,val)=>'<tr><td>'+esc(k)+'</td><td>'+val+'</td></tr>';
    const html='<table>'
      +row('Time',esc(e.timestamp))
      +row('Tool','<b>'+esc(e.tool)+'</b>')
      +row('Caller',esc(e.caller))
      +row('Risk','<span class="'+riskClass(e.risk)+'">'+e.risk+'</span>')
      +row('Approval',esc(e.approval))
      +row('Duration',e.durationMs+' ms')
      +(e.error?row('Error','<span class="risk4">'+esc(e.error)+'</span>'):'')
      +row('Input','<pre style="margin:0">'+esc(e.inputSummary)+'</pre>')
      +row('Output','<pre style="margin:0">'+esc(e.outputSummary)+'</pre>')
      +'</table>';
    openModal('Audit entry', html);
  } catch(e){ toast(e.message,'err'); }
}

async function showSkillDetail(name){
  try {
    const s=await api('skills/'+encodeURIComponent(name));
    const perms=(s.manifest&&s.manifest.permissions)||{};
    const v=s.validation||{valid:true,errors:[]};
    const row=(k,val)=>'<tr><td>'+esc(k)+'</td><td>'+val+'</td></tr>';
    const tools=(s.manifest.tools||[]).map(function(t){return '<code>'+esc(t.name)+'</code>';}).join(' ')||'<span class="muted">none</span>';
    const validHtml = v.valid ? '<span class="risk0">valid</span>' : '<span class="risk4">'+esc((v.errors||[]).join('; '))+'</span>';
    const html='<table>'
      +row('Name','<b>'+esc(s.manifest.name)+'</b>')
      +row('Version',esc(s.manifest.version))
      +row('Risk','<span class="'+riskClass(s.manifest.riskLevel)+'">'+s.manifest.riskLevel+'</span>')
      +row('State',(s.enabled?'<span class="risk0">enabled</span>':'<span class="muted">disabled</span>')+(s.bundled?' · bundled':''))
      +row('Directory','<code style="word-break:break-all">'+esc(s.dir)+'</code>')
      +row('Tools',tools)
      +row('Permissions','<pre style="margin:0">'+esc(JSON.stringify(perms,null,2))+'</pre>')
      +row('Validation',validHtml)
      +'</table>';
    let runHtml='';
    if(s.enabled && (s.manifest.tools||[]).length){
      const toolOpts=(s.manifest.tools||[]).map(function(t){return '<option value="'+esc(t.name)+'">'+esc(t.name)+'</option>';}).join('');
      runHtml='<h3 style="margin-top:16px;font-size:13px">Run a tool</h3>'
        +'<div class="row" style="gap:8px;margin-bottom:8px"><select id="skRunTool">'+toolOpts+'</select><button class="btn sm" id="skRunBtn">Run</button></div>'
        +'<textarea id="skRunInput" rows="3" placeholder="JSON input (e.g. an object)">{}</textarea>'
        +'<pre id="skRunOut" style="display:none;margin-top:8px"></pre>';
    } else if(!s.enabled){
      runHtml='<p class="muted" style="margin-top:12px;font-size:12px">Enable the skill to run its tools.</p>';
    }
    openModal('Skill: '+s.manifest.name, html+runHtml);
    const runBtn=document.getElementById('skRunBtn');
    if(runBtn){
      runBtn.onclick=action(runBtn,async()=>{
        const tool=document.getElementById('skRunTool').value;
        let input;
        try { input=JSON.parse(document.getElementById('skRunInput').value||'{}'); }
        catch(e){ toast('Input must be valid JSON: '+e.message,'err'); return; }
        const out=document.getElementById('skRunOut');
        const r=await api('skills/'+encodeURIComponent(s.manifest.name)+'/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool,input})});
        out.style.display='block';
        out.textContent=JSON.stringify(r.result,null,2);
      },'Running');
    }
  } catch(e){ toast(e.message,'err'); }
}

function setStatus(online, s){
  const pill=document.getElementById('statusPill');
  pill.textContent = online ? '● online' : '● offline';
  pill.style.color = online ? 'var(--ok)' : 'var(--danger)';
  const t=(s&&s.tunnel)||{};
  document.getElementById('tunnelPill').textContent = online ? (t.url ? ('tunnel: '+t.provider) : 'tunnel: off') : '';
}

// Poll status + pending approvals so the header and the Approvals badge stay
// live — a risk-gated action triggered by ChatGPT shows up without a manual
// refresh. Only the badge/pills update unless you're on the Approvals tab.
async function poll(){
  try{
    const s=await api('status');
    setStatus(true, s);
    const ap=await api('approvals');
    const prev=pendingApprovals;
    pendingApprovals=ap.length;
    if(pendingApprovals!==prev){
      renderNav();
      if(current==='Approvals' && !document.getElementById('modalOverlay').classList.contains('show')) render();
    }
  } catch(e){ setStatus(false); }
}

async function boot(){
  window.addEventListener('hashchange', render);
  document.getElementById('modalOverlay').addEventListener('click', (e)=>{ if(e.target.id==='modalOverlay') closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });
  renderNav();
  await poll();
  render();
  setInterval(poll, 5000);
}
boot();
</script>
</body>
</html>`;
}
