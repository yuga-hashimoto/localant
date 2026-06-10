/**
 * Self-contained local dashboard. Returns a single HTML document that talks to
 * the gateway's /api/* endpoints on the same origin. Local-only by default.
 *
 * (A full React/Vite/Tailwind build lives under a future `web/` workspace; this
 * dependency-free version ships in v1.0 so the dashboard works with zero build
 * steps and no CDN requirement.)
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
  header { padding:16px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  .pill { font-size:11px; padding:2px 8px; border-radius:999px; background:var(--panel2); color:var(--muted); }
  .layout { display:flex; min-height:calc(100vh - 53px); }
  nav { width:190px; border-right:1px solid var(--border); padding:12px; }
  nav button { display:block; width:100%; text-align:left; background:none; border:none; color:var(--muted); padding:9px 12px; border-radius:8px; cursor:pointer; font-size:14px; }
  nav button.active, nav button:hover { background:var(--panel); color:var(--text); }
  main { flex:1; padding:24px; overflow:auto; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px; }
  .card h2 { margin:0 0 12px; font-size:14px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  pre { background:var(--panel2); padding:12px; border-radius:8px; overflow:auto; font-size:12px; max-height:380px; }
  button.btn { background:var(--accent); color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px; }
  button.btn.ghost { background:var(--panel2); color:var(--text); }
  button.btn.danger { background:var(--danger); }
  button.btn.ok { background:var(--ok); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:8px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:500; }
  input,textarea { background:var(--panel2); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:8px; font-size:13px; }
  .muted { color:var(--muted); }
  .tag { font-size:11px; padding:2px 6px; border-radius:6px; background:var(--panel2); }
  .risk0{color:var(--ok)} .risk1{color:#7fd} .risk2{color:var(--warn)} .risk3{color:#ff9} .risk4{color:var(--danger)}
  .warnbox { background:rgba(210,153,34,.12); border:1px solid var(--warn); color:#f0d590; padding:10px 12px; border-radius:8px; font-size:13px; }
</style>
</head>
<body>
<header>
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
const api = (p, opts) => {
  const o = Object.assign({}, opts);
  o.headers = Object.assign({}, o.headers, { "x-dashboard-token": DASH_TOKEN });
  return fetch("/api/"+p, o).then(r => r.json());
};
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
function esc(s){ return String(s??"").replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

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
      if (res.error) {
        document.getElementById('oauthErr').textContent = res.error;
      } else {
        const target = redirectUri + (redirectUri.includes('?') ? '&' : '?') + 'code=' + res.code + '&state=' + encodeURIComponent(state);
        window.location.href = target;
      }
    } catch(e) {
      document.getElementById('oauthErr').textContent = e.message;
    }
  };

  document.getElementById('oauthDenyBtn').onclick = () => {
    window.location.href = redirectUri + (redirectUri.includes('?') ? '&' : '?') + 'error=access_denied&state=' + encodeURIComponent(state);
  };
}

const VIEWS = {
  async Home(m){
    const s=await api('status');
    const mcp=await api('mcp-endpoint');
    m.innerHTML='';
    const endpoint = mcp.endpoint || '(tunnel not running — start it from the CLI)';
    m.appendChild(el('<div class="card"><h2>Gateway</h2>'
      +'<div class="row"><span class="tag">'+esc(s.platform)+'</span><span class="tag">node '+esc(s.node)+'</span><span class="tag">pid '+s.pid+'</span></div>'
      +'<p class="muted">Started '+esc(s.startedAt)+'</p>'
      +'<p>Gateway: <code>'+esc(s.gateway)+'</code></p>'
      +'<p>Dashboard: <code>'+esc(s.dashboard||'')+'</code></p></div>'));
    const card=el('<div class="card"><h2>ChatGPT MCP endpoint</h2>'
      +'<pre id="ep">'+esc(endpoint)+'</pre>'
      +'<div class="row"><button class="btn" id="copyEp">Copy</button></div>'
      +'<ol class="muted"><li>Open <a href="https://chatgpt.com/#settings/Connectors" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:600;">ChatGPT Connectors Settings</a></li><li>Advanced settings → Developer Mode ON</li><li>Connectors → Create</li><li>Paste the URL above, name it LocalAnt</li><li>Ask ChatGPT: "Run health check on my local app"</li></ol></div>');
    m.appendChild(card);
    document.getElementById('copyEp').onclick=()=>navigator.clipboard.writeText(endpoint);
    const hc=el('<div class="card"><h2>Health check</h2><button class="btn ghost" id="hcBtn">Run</button><pre id="hcOut" style="display:none"></pre></div>');
    m.appendChild(hc);
    document.getElementById('hcBtn').onclick=async()=>{ const o=document.getElementById('hcOut'); o.style.display='block'; o.textContent=JSON.stringify(await api('health'),null,2); };
  },
  async Security(m){
    const c=await api('config');
    m.innerHTML='';
    const t=c.tunnel||{};
    if(t.provider && t.provider!=='none'){ m.appendChild(el('<div class="warnbox">⚠️ A public tunnel exposes this gateway to the internet. Anyone with the URL + token can reach your tools. Keep the token secret and stop the tunnel when not in use.</div>')); }
    m.appendChild(el('<div class="card"><h2>Allowed directories</h2><pre>'+esc(JSON.stringify(c.security.allowedDirectories,null,2))+'</pre></div>'));
    m.appendChild(el('<div class="card"><h2>Allowed commands</h2><pre>'+esc(JSON.stringify(c.security.allowedCommands,null,2))+'</pre></div>'));
    m.appendChild(el('<div class="card"><h2>Blocked command tokens</h2><pre>'+esc(JSON.stringify(c.security.blockedCommandTokens,null,2))+'</pre></div>'));
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
      once.onclick=async()=>{await api('approvals/'+a.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'once'})});render();};
      sess.onclick=async()=>{await api('approvals/'+a.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'session'})});render();};
      deny.onclick=async()=>{await api('approvals/'+a.id+'/deny',{method:'POST'});render();};
      ap.appendChild(d);
    }
  },
  async Audit(m){
    const logs=await api('audit');
    m.innerHTML='<div class="card"><h2>Audit log</h2><table><thead><tr><th>Time</th><th>Tool</th><th>Risk</th><th>Approval</th><th>ms</th><th>In</th></tr></thead><tbody id="lg"></tbody></table></div>';
    const tb=document.getElementById('lg');
    for(const e of logs){ tb.appendChild(el('<tr><td class="muted">'+esc(e.timestamp.replace("T"," ").slice(0,19))+'</td><td>'+esc(e.tool)+'</td><td class="'+riskClass(e.risk)+'">'+e.risk+'</td><td>'+esc(e.approval)+(e.error?' <span class="risk4">err</span>':'')+'</td><td>'+e.durationMs+'</td><td class="muted">'+esc(e.inputSummary).slice(0,80)+'</td></tr>')); }
  },
  async Skills(m){
    const skills=await api('skills');
    m.innerHTML='<div class="card"><h2>Skills</h2><table><thead><tr><th>Name</th><th>Ver</th><th>Risk</th><th>State</th><th>Tools</th><th></th></tr></thead><tbody id="sk"></tbody></table></div>';
    const tb=document.getElementById('sk');
    for(const s of skills){
      const tr=el('<tr><td><b>'+esc(s.name)+'</b>'+(s.generated?' <span class="tag">generated</span>':'')+'<br><span class="muted">'+esc(s.description)+'</span></td><td>'+esc(s.version)+'</td><td class="'+riskClass(s.riskLevel)+'">'+s.riskLevel+'</td><td>'+(s.enabled?'<span class="risk0">enabled</span>':'<span class="muted">disabled</span>')+(s.valid?'':' <span class="risk4">invalid</span>')+'</td><td class="muted">'+esc((s.tools||[]).join(", "))+'</td><td></td></tr>');
      const btn=el('<button class="btn ghost">'+(s.enabled?'Disable':'Enable')+'</button>');
      btn.onclick=async()=>{await api('skills/'+s.name+'/'+(s.enabled?'disable':'enable'),{method:'POST'});render();};
      tr.lastElementChild.appendChild(btn);
      tb.appendChild(tr);
    }
  },
  async Projects(m){
    const ps=await api('projects');
    m.innerHTML='<div class="card"><h2>Projects</h2><table><thead><tr><th>Name</th><th>Path</th><th>Stack</th></tr></thead><tbody id="pj"></tbody></table></div>';
    const tb=document.getElementById('pj');
    for(const p of ps){ tb.appendChild(el('<tr><td><b>'+esc(p.name)+'</b></td><td class="muted">'+esc(p.path)+'</td><td>'+esc((p.stack||[]).join(", "))+'</td></tr>')); }
    if(!ps.length) tb.appendChild(el('<tr><td colspan=3 class="muted">No projects registered.</td></tr>'));
  },
  async Secrets(m){
    const s=await api('secrets');
    m.innerHTML='<div class="card"><h2>Secrets</h2><p class="muted">Names only — values are never displayed.</p>'
      +'<ul id="sl" style="padding-left:20px;margin-bottom:24px;"></ul>'
      +'<h3>Add Secret</h3>'
      +'<div class="row" style="margin-top:12px;gap:12px;">'
        +'<input type="text" id="secName" placeholder="Secret Name (e.g. QIITA_TOKEN)" style="width:250px" />'
        +'<input type="password" id="secVal" placeholder="Secret Value" style="width:250px" />'
        +'<button class="btn" id="addSecBtn">Add Secret</button>'
      +'</div>'
      +'<div id="secErr" class="muted" style="margin-top:8px;color:var(--danger)"></div>'
      +'</div>';
    const ul=document.getElementById('sl');
    for(const n of s.names){
      const li=el('<li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">'
        +'<code>'+esc(n)+'</code>'
        +'<button class="btn danger" style="padding:2px 8px;font-size:11px;background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>'
        +'</li>');
      li.querySelector('button').onclick=async()=>{
        if(confirm('Are you sure you want to remove secret "'+n+'"?')){
          await api('secrets/'+encodeURIComponent(n),{method:'DELETE'});
          render();
        }
      };
      ul.appendChild(li);
    }
    if(!s.names.length) ul.appendChild(el('<li class="muted">No secrets stored.</li>'));

    document.getElementById('addSecBtn').onclick=async()=>{
      const name = document.getElementById('secName').value.trim();
      const value = document.getElementById('secVal').value.trim();
      const errEl = document.getElementById('secErr');
      errEl.textContent = '';
      if(!name || !value){
        errEl.textContent = 'Both Name and Value are required.';
        return;
      }
      const res = await api('secrets',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({name,value})
      });
      if(res.error) {
        errEl.textContent = res.error;
      } else {
        render();
      }
    };
  },
  async Agents(m){
    const a=await api('agents');
    m.innerHTML='<div class="card"><h2>Coding agents</h2><table><thead><tr><th>Agent</th><th>Enabled</th><th>CLI available</th><th>Command</th></tr></thead><tbody id="ag"></tbody></table></div>';
    const tb=document.getElementById('ag');
    for(const x of a){ tb.appendChild(el('<tr><td><b>'+esc(x.agent)+'</b></td><td>'+(x.enabled?'yes':'no')+'</td><td>'+(x.available?'<span class="risk0">yes</span>':'<span class="muted">no</span>')+'</td><td class="muted"><code>'+esc(x.command)+'</code></td></tr>')); }
  },
  async Settings(m){
    const c=await api('config');
    const sec=c.security||{};
    const mode=sec.mode||'strict';
    const appR1=sec.approveRisk1||false;
    const allowedDirs=sec.allowedDirectories||[];
    const allowedCmds=sec.allowedCommands||[];
    const blockedTokens=sec.blockedCommandTokens||[];

    const tun=c.tunnel||{};
    const tunProvider=tun.provider||'cloudflared';
    const tunUrl=tun.publicUrl||'';
    const tunToken=tun.token||'';
    const tunDomain=tun.domain||'';
    const tunSubdomain=tun.subdomain||'';

    m.innerHTML='<div class="card"><h2>Security Settings</h2>'
      +'<div style="margin-bottom:16px;">'
        +'<label style="display:block;margin-bottom:6px;font-weight:600;">Security Mode</label>'
        +'<select id="secMode" style="background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;font-size:13px;width:150px;">'
          +'<option value="strict"'+(mode==='strict'?' selected':'')+'>strict</option>'
          +'<option value="yolo"'+(mode==='yolo'?' selected':'')+'>yolo</option>'
        +'</select>'
        +'<p class="muted" style="margin-top:6px;font-size:12px;">In <b>yolo</b> mode, allowed directories/commands check and human approval gates are bypassed.</p>'
      +'</div>'
      +'<div style="margin-bottom:24px;">'
        +'<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">'
          +'<input type="checkbox" id="approveRisk1"'+(appR1?' checked':'')+' /> Require human approval for Risk 1 (draft) actions'
        +'</label>'
      +'</div>'
      +'</div>'
      
      +'<div class="card"><h2>Tunnel Settings (Fixed URL / Subdomain)</h2>'
      +'<div style="margin-bottom:16px;">'
        +'<label style="display:block;margin-bottom:6px;font-weight:600;">Tunnel Provider</label>'
        +'<select id="tunProvider" style="background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;font-size:13px;width:150px;">'
          +'<option value="cloudflared"'+(tunProvider==='cloudflared'?' selected':'')+'>cloudflared</option>'
          +'<option value="ngrok"'+(tunProvider==='ngrok'?' selected':'')+'>ngrok</option>'
          +'<option value="localtunnel"'+(tunProvider==='localtunnel'?' selected':'')+'>localtunnel</option>'
          +'<option value="serveo"'+(tunProvider==='serveo'?' selected':'')+'>serveo</option>'
          +'<option value="none"'+(tunProvider==='none'?' selected':'')+'>none</option>'
        +'</select>'
      +'</div>'
      +'<div style="margin-bottom:16px;display:flex;flex-direction:column;gap:12px;">'
        +'<div>'
          +'<label style="display:block;margin-bottom:6px;font-weight:600;">Custom Subdomain (localtunnel / serveo)</label>'
          +'<input type="text" id="tunSubdomain" value="'+esc(tunSubdomain)+'" placeholder="e.g. my-localant-mcp (no registration needed)" style="width:100%;" />'
        +'</div>'
        +'<div>'
          +'<label style="display:block;margin-bottom:6px;font-weight:600;">Tunnel Token / Authtoken (cloudflare / ngrok)</label>'
          +'<input type="password" id="tunToken" value="'+esc(tunToken)+'" placeholder="Cloudflare Tunnel Token or ngrok Authtoken" style="width:100%;" />'
        +'</div>'
        +'<div>'
          +'<label style="display:block;margin-bottom:6px;font-weight:600;">Custom Domain (ngrok)</label>'
          +'<input type="text" id="tunDomain" value="'+esc(tunDomain)+'" placeholder="e.g. my-app.ngrok-free.app" style="width:100%;" />'
        +'</div>'
        +'<div>'
          +'<label style="display:block;margin-bottom:6px;font-weight:600;">Public URL (optional)</label>'
          +'<input type="text" id="tunUrl" value="'+esc(tunUrl)+'" placeholder="e.g. https://my-custom-domain.com" style="width:100%;" />'
        +'</div>'
      +'</div>'
      +'<button class="btn" id="saveTunBtn">Save Tunnel Settings</button>'
      +'</div>'

      +'<div class="card"><h2>Allowed Directories</h2>'
      +'<ul id="dirList" style="padding-left:20px;margin-bottom:16px;"></ul>'
      +'<div class="row" style="gap:12px;">'
        +'<input type="text" id="newDir" placeholder="Absolute directory path" style="flex:1;" />'
        +'<button class="btn" id="addDirBtn">Add Directory</button>'
      +'</div>'
      +'</div>'

      +'<div class="card"><h2>Allowed Commands</h2>'
      +'<ul id="cmdList" style="padding-left:20px;margin-bottom:16px;"></ul>'
      +'<div class="row" style="gap:12px;">'
        +'<input type="text" id="newCmd" placeholder="Command prefix (e.g. npm run)" style="flex:1;" />'
        +'<button class="btn" id="addCmdBtn">Add Command</button>'
      +'</div>'
      +'</div>'

      +'<div class="card"><h2>Blocked Command Tokens</h2>'
      +'<ul id="tokList" style="padding-left:20px;margin-bottom:16px;"></ul>'
      +'<div class="row" style="gap:12px;">'
        +'<input type="text" id="newTok" placeholder="Token (e.g. sudo)" style="flex:1;" />'
        +'<button class="btn" id="addTokBtn">Add Token</button>'
      +'</div>'
      +'</div>'

      +'<div class="card"><h2>Raw JSON Config</h2><pre>'+esc(JSON.stringify(c,null,2))+'</pre></div>';

    // Event Handlers
    const saveSec = async (update) => {
      await api('config', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ security: update })
      });
      render();
    };

    const saveTun = async (update) => {
      await api('config', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ tunnel: update })
      });
      render();
    };

    document.getElementById('secMode').onchange=async(e)=>saveSec({ mode: e.target.value });
    document.getElementById('approveRisk1').onchange=async(e)=>saveSec({ approveRisk1: e.target.checked });
    document.getElementById('tunProvider').onchange=async(e)=>saveTun({ provider: e.target.value });
    document.getElementById('saveTunBtn').onclick=async()=>{
      const token = document.getElementById('tunToken').value.trim();
      const domain = document.getElementById('tunDomain').value.trim();
      const publicUrl = document.getElementById('tunUrl').value.trim();
      const subdomain = document.getElementById('tunSubdomain').value.trim();
      await saveTun({ token, domain, publicUrl, subdomain });
    };

    // Render Lists
    const dirList=document.getElementById('dirList');
    allowedDirs.forEach(d => {
      const li=el('<li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">'
        +'<code>'+esc(d)+'</code>'
        +'<button class="btn danger" style="padding:2px 8px;font-size:11px;background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>'
        +'</li>');
      li.querySelector('button').onclick=()=>saveSec({ allowedDirectories: allowedDirs.filter(x=>x!==d) });
      dirList.appendChild(li);
    });
    if(!allowedDirs.length) dirList.innerHTML='<li class="muted">No directories allowlisted.</li>';

    document.getElementById('addDirBtn').onclick=async()=>{
      const val=document.getElementById('newDir').value.trim();
      if(val) saveSec({ allowedDirectories: [...allowedDirs, val] });
    };

    const cmdList=document.getElementById('cmdList');
    allowedCmds.forEach(c => {
      const li=el('<li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">'
        +'<code>'+esc(c)+'</code>'
        +'<button class="btn danger" style="padding:2px 8px;font-size:11px;background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>'
        +'</li>');
      li.querySelector('button').onclick=()=>saveSec({ allowedCommands: allowedCmds.filter(x=>x!==c) });
      cmdList.appendChild(li);
    });
    if(!allowedCmds.length) cmdList.innerHTML='<li class="muted">No commands allowlisted.</li>';

    document.getElementById('addCmdBtn').onclick=async()=>{
      const val=document.getElementById('newCmd').value.trim();
      if(val) saveSec({ allowedCommands: [...allowedCmds, val] });
    };

    const tokList=document.getElementById('tokList');
    blockedTokens.forEach(t => {
      const li=el('<li style="margin-bottom:8px;display:flex;align-items:center;gap:12px;">'
        +'<code>'+esc(t)+'</code>'
        +'<button class="btn danger" style="padding:2px 8px;font-size:11px;background:none;border:1px solid var(--danger);color:var(--danger)">Remove</button>'
        +'</li>');
      li.querySelector('button').onclick=()=>saveSec({ blockedCommandTokens: blockedTokens.filter(x=>x!==t) });
      tokList.appendChild(li);
    });
    if(!blockedTokens.length) tokList.innerHTML='<li class="muted">No tokens blocked.</li>';

    document.getElementById('addTokBtn').onclick=async()=>{
      const val=document.getElementById('newTok').value.trim();
      if(val) saveSec({ blockedCommandTokens: [...blockedTokens, val] });
    };
  },
};

async function boot(){
  window.addEventListener('hashchange', render);
  renderNav();
  try{ const s=await api('status'); document.getElementById('statusPill').textContent='● online'; document.getElementById('statusPill').style.color='var(--ok)';
    const t=s.tunnel||{}; document.getElementById('tunnelPill').textContent = t.url? ('tunnel: '+t.provider) : 'tunnel: off'; }
  catch{ document.getElementById('statusPill').textContent='● offline'; }
  render();
}
boot();
</script>
</body>
</html>`;
}
