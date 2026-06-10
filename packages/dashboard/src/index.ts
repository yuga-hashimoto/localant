/**
 * Self-contained local dashboard. Returns a single HTML document that talks to
 * the gateway's /api/* endpoints on the same origin. Local-only by default.
 *
 * Dependency-free and build-free by design: this ships as one HTML string so
 * the dashboard works with zero build steps and no CDN requirement. The inner
 * <script> uses string concatenation (no template literals) so it can live
 * inside this outer template literal without escaping collisions.
 */

/** The ant logo, inlined so the header renders with no extra request. */
const LOGO_SVG = `<svg viewBox="0 0 128 128" fill="none" width="26" height="26" aria-hidden="true">
  <ellipse cx="52" cy="70" rx="20" ry="14" fill="#4f8cff"/>
  <ellipse cx="88" cy="68" rx="18" ry="13" fill="#4f8cff"/>
  <circle cx="42" cy="50" r="15" fill="#4f8cff"/>
  <circle cx="37" cy="47" r="3" fill="#0b0f17"/>
  <circle cx="46" cy="47" r="3" fill="#0b0f17"/>
  <path d="M35 38 Q28 18 22 10" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M46 38 Q50 16 58 8" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="22" cy="9" r="2.5" fill="#7fafff"/>
  <circle cx="58" cy="7" r="2.5" fill="#7fafff"/>
  <path d="M42 68 L28 88" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M52 70 L52 92" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M62 68 L72 90" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M78 66 L68 90" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M88 68 L92 92" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M98 64 L108 88" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="68" y="40" width="28" height="10" rx="2" fill="#1b2433" stroke="#3fb950" stroke-width="0.8"/>
  <text x="72" y="48" font-family="monospace" font-size="7" fill="#3fb950">&gt;_</text>
</svg>`;

export function dashboardHtml(token = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
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
</style>
</head>
<body>
<div id="toast"></div>
<header>
  <span class="logo">${LOGO_SVG}</span>
  <h1>LocalAnt</h1>
  <span class="pill" id="statusPill">connecting…</span>
  <span class="pill" id="tunnelPill"></span>
</header>
<div class="layout">
  <nav id="nav"></nav>
  <main id="main"></main>
</div>
<script>
const TABS = ["Home","Security","Approvals","Audit","Skills","Projects","Secrets","Agents","Settings"];
let current = "Home";
const DASH_TOKEN = ${JSON.stringify(token)};

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
  for(const t of TABS){ const b=el('<button>'+t+'</button>'); if(t===current)b.className='active'; b.onclick=()=>{current=t;renderNav();render();}; nav.appendChild(b); }
}

async function render(){
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
  const card=el('<div class="card"><h2>Tunnel</h2>'
    +'<p>Provider: <code>'+esc(t.provider)+'</code> · Status: <code>'+esc(t.status)+'</code></p>'
    +(t.url?'<p>URL: <code>'+esc(t.url)+'</code></p>':'<p class="muted">No public URL.</p>')
    +(t.error?'<p class="risk4">'+esc(t.error)+'</p>':'')
    +'<div class="row"><button class="btn" id="tunStart">Start</button>'
    +'<button class="btn ghost" id="tunRestart">Restart</button>'
    +'<button class="btn danger" id="tunStop">Stop</button></div></div>');
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
      +'<div class="row"><span class="tag">'+esc(s.platform)+'</span><span class="tag">node '+esc(s.node)+'</span><span class="tag">pid '+s.pid+'</span></div>'
      +'<p class="muted">Started '+esc(s.startedAt)+'</p>'
      +'<p>Gateway: <code>'+esc(s.gateway)+'</code></p>'
      +'<p>Dashboard: <code>'+esc(s.dashboard||'')+'</code></p></div>'));

    if(t.url && /trycloudflare\\.com/.test(t.url)){
      m.appendChild(el('<div class="warnbox">⚠️ This is a temporary Quick Tunnel URL — it <b>changes every restart</b>, so you would have to recreate the ChatGPT connector each time. To get a permanent URL (and never rebuild the connector), set a fixed tunnel in <b>Settings</b> (ngrok static domain, a custom subdomain, or your own domain). The auth token is persistent, so a fixed URL means no re-auth.</div>'));
    }

    const card=el('<div class="card"><h2>ChatGPT MCP endpoint</h2>'
      +'<pre id="ep">'+esc(endpoint)+'</pre>'
      +'<div class="row"><button class="btn" id="copyEp">Copy</button></div>'
      +'<ol class="muted"><li>Open <a href="https://chatgpt.com/#settings/Connectors" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;">ChatGPT Connectors Settings</a></li><li>Advanced settings → Developer Mode ON</li><li>Connectors → Create</li><li>Paste the URL above, name it LocalAnt</li><li>Ask ChatGPT: "Run health check on my local app"</li></ol></div>');
    m.appendChild(card);
    document.getElementById('copyEp').onclick=()=>{ navigator.clipboard.writeText(endpoint); toast('Copied endpoint'); };

    m.appendChild(tunnelControls(t));

    const hc=el('<div class="card"><h2>Health check</h2><button class="btn ghost" id="hcBtn">Run</button><pre id="hcOut" style="display:none"></pre></div>');
    m.appendChild(hc);
    document.getElementById('hcBtn').onclick=action(document.getElementById('hcBtn'),async()=>{ const o=document.getElementById('hcOut'); o.style.display='block'; o.textContent=JSON.stringify(await api('health'),null,2); });
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
    m.innerHTML='<div class="card"><h2>Pending approvals</h2><div id="ap"></div></div>';
    const ap=document.getElementById('ap');
    if(!list.length){ ap.innerHTML='<p class="muted">No pending approvals.</p>'; return; }
    for(const a of list){
      const d=el('<div class="card" style="background:var(--panel2)"><div class="row"><b>'+esc(a.tool)+'</b> <span class="tag '+riskClass(a.risk)+'">risk '+a.risk+'</span> <span class="tag">'+esc(a.requirement)+'</span></div>'
        +'<p class="muted">'+esc(a.summary)+'</p><p class="muted">'+esc(a.reason)+'</p>'
        +'<div class="row"><button class="btn ok">Approve once</button><button class="btn">Approve for session</button><button class="btn danger">Deny</button></div></div>');
      const [once,sess,deny]=d.querySelectorAll('button');
      once.onclick=action(once,async()=>{await api('approvals/'+a.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'once'})});render();});
      sess.onclick=action(sess,async()=>{await api('approvals/'+a.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'session'})});render();});
      deny.onclick=action(deny,async()=>{await api('approvals/'+a.id+'/deny',{method:'POST'});render();});
      ap.appendChild(d);
    }
  },

  async Audit(m){
    const logs=await api('audit');
    m.innerHTML='<div class="card"><h2>Audit log</h2><table><thead><tr><th>Time</th><th>Tool</th><th>Risk</th><th>Approval</th><th>ms</th><th>In</th></tr></thead><tbody id="lg"></tbody></table></div>';
    const tb=document.getElementById('lg');
    if(!logs.length){ tb.appendChild(el('<tr><td colspan=6 class="muted">No audit entries yet.</td></tr>')); return; }
    for(const e of logs){ tb.appendChild(el('<tr><td class="muted">'+esc(e.timestamp.replace("T"," ").slice(0,19))+'</td><td>'+esc(e.tool)+'</td><td class="'+riskClass(e.risk)+'">'+e.risk+'</td><td>'+esc(e.approval)+(e.error?' <span class="risk4">err</span>':'')+'</td><td>'+e.durationMs+'</td><td class="muted">'+esc(String(e.inputSummary).slice(0,80))+'</td></tr>')); }
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
        +'</div><p class="muted" style="margin-top:8px;">The generated skill is saved <b>disabled</b>. Review its permissions, then enable it.</p></div>';
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
  },

  async Projects(m){
    const ps=await api('projects');
    m.innerHTML='<div class="card"><h2>Projects</h2><table><thead><tr><th>Name</th><th>Path</th><th>Stack</th><th></th></tr></thead><tbody id="pj"></tbody></table></div>'
      +'<div class="card"><h2>Register project</h2>'
        +'<div class="row" style="gap:12px;">'
          +'<input type="text" id="pjPath" placeholder="absolute path (e.g. /Users/me/Projects/app)" style="flex:1;min-width:240px" />'
          +'<input type="text" id="pjName" placeholder="name (optional)" style="width:180px" />'
          +'<button class="btn" id="pjAdd">Register</button>'
        +'</div><p class="muted" style="margin-top:8px;">In strict mode the path must be inside an allowed directory.</p></div>';
    const tb=document.getElementById('pj');
    if(!ps.length) tb.appendChild(el('<tr><td colspan=4 class="muted">No projects registered.</td></tr>'));
    for(const p of ps){
      const tr=el('<tr><td><b>'+esc(p.name)+'</b></td><td class="muted">'+esc(p.path)+'</td><td>'+esc((p.stack||[]).join(", "))+'</td><td></td></tr>');
      const rm=el('<button class="btn danger sm" style="background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>');
      rm.onclick=action(rm,async()=>{ if(confirm('Remove project "'+p.name+'"?')){ await api('projects/'+encodeURIComponent(p.id),{method:'DELETE'}); toast('Removed '+p.name); render(); } });
      tr.lastElementChild.appendChild(rm);
      tb.appendChild(tr);
    }
    document.getElementById('pjAdd').onclick=action(document.getElementById('pjAdd'),async()=>{
      const pathVal=document.getElementById('pjPath').value.trim();
      const name=document.getElementById('pjName').value.trim();
      if(!pathVal){ toast('Path is required.','err'); return; }
      await api('projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:pathVal,name:name||undefined})});
      toast('Project registered');
      render();
    },'Registering');
  },

  async Secrets(m){
    const s=await api('secrets');
    m.innerHTML='<div class="card"><h2>Secrets</h2><p class="muted">Names only — values are never displayed.</p>'
      +'<ul id="sl" style="padding-left:20px;margin-bottom:24px;"></ul>'
      +'<h3>Add secret</h3>'
      +'<div class="row" style="margin-top:12px;gap:12px;">'
        +'<input type="text" id="secName" placeholder="Secret name (e.g. QIITA_TOKEN)" style="width:250px" />'
        +'<input type="password" id="secVal" placeholder="Secret value" style="width:250px" />'
        +'<button class="btn" id="addSecBtn">Add secret</button>'
      +'</div></div>';
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

  async Agents(m){
    const a=await api('agents');
    const tasks=await api('agents/tasks');
    m.innerHTML='<div class="card"><h2>Coding agents</h2><table><thead><tr><th>Agent</th><th>CLI available</th><th>Command</th><th>Enabled</th></tr></thead><tbody id="ag"></tbody></table></div>';
    const tb=document.getElementById('ag');
    for(const x of a){
      const avail = x.available ? '<span class="risk0">yes</span>' : '<span class="risk4">not on PATH</span>';
      const tr=el('<tr><td><b>'+esc(x.agent)+'</b></td><td>'+avail+'</td><td class="muted"><code>'+esc(x.command)+'</code></td><td></td></tr>');
      const toggle=el('<button class="btn '+(x.enabled?'ok':'ghost')+' sm">'+(x.enabled?'Enabled':'Disabled')+'</button>');
      toggle.onclick=action(toggle,async()=>{ await api('agents/'+encodeURIComponent(x.agent)+'/'+(x.enabled?'disable':'enable'),{method:'POST'}); toast(x.agent+(x.enabled?' disabled':' enabled')); render(); });
      tr.lastElementChild.appendChild(toggle);
      if(!x.available){ tr.lastElementChild.appendChild(el('<span class="muted" style="margin-left:8px;font-size:11px">install <code>'+esc(x.command)+'</code> to run it</span>')); }
      tb.appendChild(tr);
    }

    const taskCard=el('<div class="card"><h2>Agent tasks</h2><table><thead><tr><th>Created</th><th>Agent</th><th>Mode</th><th>Status</th><th>Branch</th><th></th></tr></thead><tbody id="tk"></tbody></table></div>');
    m.appendChild(taskCard);
    const tkb=taskCard.querySelector('#tk');
    if(!tasks.length){ tkb.appendChild(el('<tr><td colspan=6 class="muted">No agent tasks yet.</td></tr>')); }
    for(const t of tasks){
      const stCls = t.status==='completed'?'risk0':(t.status==='failed'?'risk4':(t.status==='running'?'risk2':''));
      const tr=el('<tr><td class="muted">'+esc(String(t.createdAt).replace("T"," ").slice(0,19))+'</td><td>'+esc(t.agent)+'</td><td>'+esc(t.mode)+'</td><td class="'+stCls+'">'+esc(t.status)+'</td><td class="muted">'+esc(t.branch||'')+'</td><td></td></tr>');
      const cell=tr.lastElementChild;
      const logs=el('<button class="btn ghost sm">Logs</button>');
      logs.onclick=action(logs,async()=>{ const r=await api('agents/tasks/'+encodeURIComponent(t.id)+'/logs'); const pre=el('<pre></pre>'); pre.textContent=r.logs||'(no output)'; const ex=tr.nextElementSibling; if(ex&&ex.classList.contains('logrow')){ ex.remove(); return; } const lr=el('<tr class="logrow"><td colspan=6></td></tr>'); lr.firstElementChild.appendChild(pre); tr.after(lr); });
      cell.appendChild(logs);
      if(t.status==='running'){
        const stop=el('<button class="btn danger sm" style="margin-left:6px">Stop</button>');
        stop.onclick=action(stop,async()=>{ await api('agents/tasks/'+encodeURIComponent(t.id)+'/stop',{method:'POST'}); toast('Stopped'); render(); });
        cell.appendChild(stop);
      }
      tkb.appendChild(tr);
    }
  },

  async Settings(m){
    const c=await api('config');
    const sec=c.security||{};
    const mode=sec.mode||'open';
    const allowedDirs=sec.allowedDirectories||[];
    const allowedCmds=sec.allowedCommands||[];
    const blockedTokens=sec.blockedCommandTokens||[];
    const CORE=["sudo","su","mkfs","mkfs.ext4","dd","fdisk","diskutil","shutdown","reboot"];

    const tun=c.tunnel||{};

    m.innerHTML='<div class="card"><h2>Security settings</h2>'
      +'<div class="field"><label>Security mode</label>'
        +'<select id="secMode" style="width:160px">'
          +'<option value="open"'+(mode==='open'?' selected':'')+'>open (default)</option>'
          +'<option value="strict"'+(mode==='strict'?' selected':'')+'>strict</option>'
          +'<option value="yolo"'+(mode==='yolo'?' selected':'')+'>yolo</option>'
        +'</select>'
        +'<p class="muted" style="margin-top:6px;font-size:12px;"><b>open</b>: deny-list for personal use — anything except the blocklist; only risk-4 needs approval. <b>strict</b>: allow-list + per-risk approval (shared machines). <b>yolo</b>: no approval gates at all.</p>'
      +'</div>'
      +'<div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="approveRisk1"'+(sec.approveRisk1?' checked':'')+' style="width:auto"/> Require approval for Risk 1 (draft) actions</label></div>'
      +'</div>'

      +'<div class="card"><h2>Tunnel — fixed URL</h2>'
      +'<p class="muted" style="margin-top:0">A fixed URL means you never recreate the ChatGPT connector. Pick a provider and fill the matching field, then Save &amp; restart.</p>'
      +'<div class="field"><label>Provider</label>'
        +'<select id="tunProvider" style="width:160px">'
          +['cloudflared','ngrok','localtunnel','serveo','none'].map(function(p){return '<option value="'+p+'"'+((tun.provider||'cloudflared')===p?' selected':'')+'>'+p+'</option>';}).join('')
        +'</select></div>'
      +'<div class="field"><label>Custom subdomain (localtunnel / serveo — no registration)</label><input type="text" id="tunSubdomain" value="'+esc(tun.subdomain||'')+'" placeholder="e.g. my-localant-mcp" /></div>'
      +'<div class="field"><label>Token / authtoken (cloudflared tunnel token / ngrok authtoken)</label><input type="password" id="tunToken" value="'+esc(tun.token||'')+'" placeholder="Cloudflare Tunnel token or ngrok authtoken" /></div>'
      +'<div class="field"><label>Custom domain (ngrok static domain)</label><input type="text" id="tunDomain" value="'+esc(tun.domain||'')+'" placeholder="e.g. my-app.ngrok-free.app" /></div>'
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

    const saveSec = async (update) => { await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({security:update})}); };
    const saveTun = async (update) => { await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tunnel:update})}); };

    document.getElementById('secMode').onchange=async(e)=>{ try{ await saveSec({mode:e.target.value}); toast('Mode → '+e.target.value); render(); }catch(err){ toast(err.message,'err'); } };
    document.getElementById('approveRisk1').onchange=async(e)=>{ try{ await saveSec({approveRisk1:e.target.checked}); toast('Saved'); }catch(err){ toast(err.message,'err'); } };
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
};

async function showSkillDetail(name){
  try {
    const s=await api('skills/'+encodeURIComponent(name));
    const perms=(s.manifest&&s.manifest.permissions)||{};
    const v=s.validation||{valid:true,errors:[]};
    const lines=[
      'name: '+s.manifest.name,
      'version: '+s.manifest.version,
      'risk: '+s.manifest.riskLevel,
      'enabled: '+s.enabled,
      'bundled: '+s.bundled,
      'dir: '+s.dir,
      'tools: '+(s.manifest.tools||[]).map(function(t){return t.name;}).join(', '),
      'permissions: '+JSON.stringify(perms),
      'valid: '+v.valid+(v.errors&&v.errors.length?(' ('+v.errors.join('; ')+')'):'')
    ];
    alert(lines.join('\\n'));
  } catch(e){ toast(e.message,'err'); }
}

async function boot(){
  window.addEventListener('hashchange', render);
  renderNav();
  try{
    const s=await api('status');
    document.getElementById('statusPill').textContent='● online';
    document.getElementById('statusPill').style.color='var(--ok)';
    const t=s.tunnel||{};
    document.getElementById('tunnelPill').textContent = t.url ? ('tunnel: '+t.provider) : 'tunnel: off';
  } catch(e){ document.getElementById('statusPill').textContent='● offline'; }
  render();
}
boot();
</script>
</body>
</html>`;
}
