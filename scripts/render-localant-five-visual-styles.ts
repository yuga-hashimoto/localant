import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

type SceneSpec = {
  id: string;
  title: string;
  label: string;
  narration: string;
};

type VariantSpec = {
  key: string;
  title: string;
  style: "saas" | "dashboard" | "developer" | "security" | "motion";
  scenes: SceneSpec[];
};

type RenderScene = SceneSpec & {
  audioFile: string;
  audioDurationSeconds: number;
  durationSeconds: number;
  startFrame: number;
  durationInFrames: number;
};

const repoRoot = process.cwd();
const outRoot = path.join(repoRoot, ".tmp-localant-five-visual-styles");
const publicOutDir = "/Users/yu-ga/.localant/video-studio/projects/mqugi6qf-localant-chatgpt-pc/output";
const endpoint = "http://127.0.0.1:50021";
const speakerId = 2;
const fps = 24;
const width = 1080;
const height = 1920;

const variants: VariantSpec[] = [
  {
    key: "saas-promo",
    title: "LocalAnt SaaS Promo",
    style: "saas",
    scenes: [
      { id: "s1", title: "ChatGPTの手をPCへ", label: "ChatGPT → LocalAnt → Local PC", narration: "ChatGPTが、あなたのローカルPCで作業できるとしたら。LocalAntは、その体験を安全に実現するためのアプリです。" },
      { id: "s2", title: "AIからローカル実行へ", label: "AI instructions become local actions", narration: "ChatGPTの指示を、Shell、Git、ブラウザ、ファイル操作へつなぎます。会話から作業実行まで、流れを止めません。" },
      { id: "s3", title: "主要機能", label: "Shell / Git / Browser / ADB / Files", narration: "開発、検証、ブラウザ確認、Android操作、ファイル整理。よく使う作業を、LocalAntがまとめて受け持ちます。" },
      { id: "s4", title: "安全に進める", label: "Review before action", narration: "危険な操作は自動で止まり、確認してから進めます。実行履歴も残るので、あとから作業内容を追跡できます。" },
      { id: "s5", title: "制作も自動化", label: "Script → Voice → Captions → Video", narration: "さらに、台本作成、音声生成、字幕、動画レンダリング、投稿準備まで、ひとつのワークフローとして自動化できます。" },
      { id: "s6", title: "LocalAnt", label: "Build faster. Operate safer.", narration: "LocalAnt。ChatGPTに、ローカルで働く手を。開発も制作も、もっと速く、もっと安全に。" },
    ],
  },
  {
    key: "dashboard-demo",
    title: "LocalAnt Dashboard Demo",
    style: "dashboard",
    scenes: [
      { id: "s1", title: "ダッシュボードから一括管理", label: "Dashboard overview", narration: "LocalAntは、ChatGPTとローカルPCの作業を、ひとつのダッシュボードで見える化します。" },
      { id: "s2", title: "タスク一覧", label: "Task queue", narration: "左側にはツール、中央には実行中のタスク、右側には結果とログ。今なにが起きているかを、画面で確認できます。" },
      { id: "s3", title: "承認キュー", label: "Review queue", narration: "注意が必要な操作は、承認キューに入ります。内容を確認してから実行できるので、安心して自動化できます。" },
      { id: "s4", title: "実行ログ", label: "Execution history", narration: "Shell、Git、ブラウザ、ADB、ファイル操作。どのツールをいつ使ったか、すべて履歴として残ります。" },
      { id: "s5", title: "動画生成パネル", label: "Video Studio", narration: "Video Studioでは、台本、音声、字幕、レンダリング、投稿準備までを、同じ画面の流れで進められます。" },
      { id: "s6", title: "操作できるAIへ", label: "From chat to operation", narration: "LocalAntは、ChatGPTをただの相談相手から、ローカル環境につながる作業アシスタントへ変えます。" },
    ],
  },
  {
    key: "developer-tool",
    title: "LocalAnt Developer Tool",
    style: "developer",
    scenes: [
      { id: "s1", title: "開発作業をChatGPTから", label: "Code / Terminal / Browser", narration: "コード修正、コマンド実行、ブラウザ確認。開発で繰り返す作業を、ChatGPTから直接進められます。" },
      { id: "s2", title: "Gitと差分確認", label: "git diff / test / commit", narration: "変更内容を確認し、差分を見て、テストを実行する。LocalAntは、開発フローに沿って作業をつなぎます。" },
      { id: "s3", title: "ブラウザ検証", label: "Playwright-style checks", narration: "ブラウザを開いて画面を確認し、スクリーンショットを取り、UIの動作を検証することもできます。" },
      { id: "s4", title: "Android操作", label: "ADB capture / device check", narration: "ADBを使ったAndroid端末の確認にも対応。モバイルアプリの検証作業にもつなげられます。" },
      { id: "s5", title: "ファイルとログ", label: "Files / logs / artifacts", narration: "生成されたファイル、ログ、成果物を整理し、次の作業へ引き継ぎます。手作業の抜け漏れを減らします。" },
      { id: "s6", title: "開発環境にAIの手を", label: "Your local AI operator", narration: "LocalAntは、ChatGPTを開発環境につながる実行アシスタントへ変える、ローカルブリッジです。" },
    ],
  },
  {
    key: "security-control",
    title: "LocalAnt Security Control",
    style: "security",
    scenes: [
      { id: "s1", title: "安全に動く自動化", label: "Control before execution", narration: "AIにローカルPCを任せるなら、安全性が重要です。LocalAntは、実行前の制御を重視しています。" },
      { id: "s2", title: "リスク判定", label: "Risk level check", narration: "操作内容を確認し、危険度に応じて扱いを変えます。問題がありそうな操作は、そのまま実行しません。" },
      { id: "s3", title: "承認フロー", label: "Approval queue", narration: "必要な操作は承認待ちになります。人が確認してから実行することで、自動化と安全性を両立します。" },
      { id: "s4", title: "監査ログ", label: "Audit trail", narration: "いつ、どのツールで、何を実行したか。履歴が残るため、あとから確認できます。" },
      { id: "s5", title: "安全な拡張", label: "Safe local automation", narration: "Shell、Git、ブラウザ、ADB、ファイル操作。強力な操作ほど、制御と記録が必要です。LocalAntはそこを支えます。" },
      { id: "s6", title: "信頼できるAI操作", label: "Visible. Controlled. Auditable.", narration: "LocalAntは、見える、止められる、追跡できる。ローカルPC自動化のための安全な入り口です。" },
    ],
  },
  {
    key: "motion-graphic-ad",
    title: "LocalAnt Motion Graphic Ad",
    style: "motion",
    scenes: [
      { id: "s1", title: "会話だけで終わらせない", label: "Chat is not enough", narration: "ChatGPTに聞くだけで終わっていませんか。LocalAntなら、その先の作業までつなげられます。" },
      { id: "s2", title: "つなぐ", label: "ChatGPT → LocalAnt → PC", narration: "ChatGPTとローカルPCをつなぐ。これだけで、AIは相談相手から、作業の起点へ変わります。" },
      { id: "s3", title: "動かす", label: "Run tools locally", narration: "Shell、Git、ブラウザ、ADB、ファイル操作。いつものローカル作業を、AIから実行できます。" },
      { id: "s4", title: "守る", label: "Review risky actions", narration: "危険な操作は止める。承認してから進める。ログを残す。安心して任せるための仕組みがあります。" },
      { id: "s5", title: "作る", label: "Create content workflow", narration: "記事、検証、動画生成、投稿準備。LocalAntは、開発だけでなく制作フローにも広がります。" },
      { id: "s6", title: "LocalAnt", label: "Give ChatGPT local hands", narration: "LocalAnt。ChatGPTに、ローカルで働く手を。あなたのPC作業を、次の段階へ。" },
    ],
  },
];

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sec(n: number) {
  return Math.round(n * 100) / 100;
}

function durationOf(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" }).trim();
  return Number(out);
}

async function synth(text: string, outFile: string) {
  const qRes = await fetch(`${endpoint}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`, { method: "POST" });
  if (!qRes.ok) throw new Error(`VOICEVOX audio_query failed: ${qRes.status}`);
  const query: any = await qRes.json();
  query.speedScale = 1.0;
  query.pitchScale = 0;
  query.intonationScale = 1.08;
  query.volumeScale = 1.0;
  query.prePhonemeLength = 0.1;
  query.postPhonemeLength = 0.22;
  const sRes = await fetch(`${endpoint}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!sRes.ok) throw new Error(`VOICEVOX synthesis failed: ${sRes.status}`);
  fs.writeFileSync(outFile, Buffer.from(await sRes.arrayBuffer()));
}

async function prepareAudio(variant: VariantSpec, dir: string): Promise<{ scenes: RenderScene[]; narrationFile: string; audioDurationSeconds: number }> {
  const audioDir = path.join(dir, "audio");
  ensureDir(audioDir);
  let frame = 0;
  const scenes: RenderScene[] = [];
  for (let i = 0; i < variant.scenes.length; i++) {
    const scene = variant.scenes[i];
    const wav = path.join(audioDir, `${scene.id}.wav`);
    await synth(scene.narration, wav);
    const audioDurationSeconds = durationOf(wav);
    const durationSeconds = sec(audioDurationSeconds + 0.65);
    const durationInFrames = Math.ceil(durationSeconds * fps);
    scenes.push({ ...scene, audioFile: `audio/${scene.id}.wav`, audioDurationSeconds: sec(audioDurationSeconds), durationSeconds, startFrame: frame, durationInFrames });
    frame += durationInFrames;
  }
  const listFile = path.join(audioDir, "concat.txt");
  fs.writeFileSync(listFile, scenes.map((s) => `file '${path.join(audioDir, `${s.id}.wav`).replace(/'/g, "'\\''")}'`).join("\n"));
  const narrationFile = path.join(audioDir, "narration.wav");
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", narrationFile], { stdio: "ignore" });
  return { scenes, narrationFile, audioDurationSeconds: sec(durationOf(narrationFile)) };
}

function entrySource(data: any) {
  const encoded = JSON.stringify(data).replace(/</g, "\\u003c");
  return `
import React from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const DATA = ${encoded};
const neon = '#39ff88';
const cyan = '#67e8f9';
const yellow = '#facc15';
const red = '#fb7185';
const purple = '#a78bfa';
const font = 'Inter, Hiragino Sans, Yu Gothic, Noto Sans JP, -apple-system, BlinkMacSystemFont, sans-serif';
const ease = (v, i, o) => interpolate(v, i, o, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

function Caption({scene}) {
  const f = useCurrentFrame();
  const y = ease(f, [8, 24], [42, 0]);
  const op = ease(f, [8, 24], [0, 1]);
  return <div style={{position:'absolute', left:62, right:62, bottom:132, opacity:op, transform:'translateY('+y+'px)', zIndex:80}}>
    <div style={{fontFamily:font, color:'white', fontSize: scene.label.length > 34 ? 38 : 45, fontWeight:1000, lineHeight:1.16, textAlign:'center', textShadow:'0 4px 0 #000, 0 0 26px #000', WebkitTextStroke:'1.4px rgba(0,0,0,.9)'}}>{scene.label}</div>
  </div>;
}
function Progress() { const f=useCurrentFrame(); const {durationInFrames}=useVideoConfig(); const w=ease(f,[0,durationInFrames-1],[0,100]); return <div style={{position:'absolute',left:42,right:42,bottom:48,height:12,background:'rgba(255,255,255,.16)',borderRadius:999,overflow:'hidden',zIndex:99}}><div style={{width:w+'%',height:'100%',background:'linear-gradient(90deg,'+neon+','+cyan+','+purple+')'}} /></div>; }
function Top({tag}) { return <div style={{position:'absolute',top:42,left:54,right:54,zIndex:70,display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:font}}><div style={{display:'flex',gap:14,alignItems:'center'}}><div style={{width:42,height:42,borderRadius:14,background:'linear-gradient(135deg,'+neon+','+cyan+')',boxShadow:'0 0 32px rgba(57,255,136,.55)'}}/><div style={{fontSize:28,fontWeight:1000,color:'#ecfeff'}}>LocalAnt</div></div><div style={{fontSize:20,fontWeight:900,color:'#a7f3d0',padding:'10px 16px',border:'1px solid rgba(167,243,208,.35)',borderRadius:999,background:'rgba(2,6,23,.42)'}}>{tag}</div></div> }
function GlobalBg({mode}) { const f=useCurrentFrame(); const {width,height}=useVideoConfig(); const grid = mode==='developer' ? '#22d3ee' : mode==='security' ? '#facc15' : '#39ff88'; return <AbsoluteFill style={{background:'#050816',overflow:'hidden'}}>
  <div style={{position:'absolute',inset:-260,background:'radial-gradient(circle at '+(20+Math.sin(f/70)*12)+'% 16%, rgba(57,255,136,.42), transparent 29%), radial-gradient(circle at 78% '+(30+Math.cos(f/80)*14)+'%, rgba(103,232,249,.32), transparent 32%), radial-gradient(circle at 42% 86%, rgba(167,139,250,.24), transparent 34%)',filter:'blur(8px)'}} />
  <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px)',backgroundSize: mode==='motion'?'96px 96px':'72px 72px',transform:'translate('+(-f*.45%72)+'px,'+(-f*.32%72)+'px)',opacity:.38}}/>
  {Array.from({length: mode==='motion'?18:12}).map((_,i)=>{const x=(i*173+f*(.45+(i%5)*.08))%(width+180)-90; const y=(i*251+Math.sin(f/28+i)*42)%height; const s=4+(i%6)*2; return <div key={i} style={{position:'absolute',left:x,top:y,width:s,height:s,borderRadius:99,background:i%3===0?grid:(i%3===1?cyan:purple),opacity:.15+(i%5)*.06,boxShadow:'0 0 18px currentColor'}}/>})}
</AbsoluteFill> }

function SaasScene({scene,index}) { const f=useCurrentFrame(); const pop=spring({frame:f,fps:30,config:{damping:14,stiffness:90}}); const y=ease(f,[0,28],[80,0]); return <AbsoluteFill style={{fontFamily:font}}><Top tag='SaaS Promo'/><div style={{position:'absolute',left:62,right:62,top:175,color:'white',transform:'translateY('+y+'px)'}}><div style={{fontSize:30,color:'#99f6e4',fontWeight:1000,letterSpacing:3}}>PREMIUM PRODUCT</div><div style={{fontSize:76,lineHeight:.98,fontWeight:1000,letterSpacing:-3,marginTop:18}}>{scene.title}</div></div><div style={{position:'absolute',left:70,right:70,top:610,height:530,transform:'scale('+(0.92+pop*.08)+')',display:'grid',gridTemplateColumns:'1fr 1fr',gap:26}}>{['ChatGPT','LocalAnt','Local PC','Workflow'].map((x,i)=><div key={x} style={{borderRadius:34,background:i===1?'linear-gradient(135deg,#dcfce7,#67e8f9)':'rgba(255,255,255,.92)',color:'#0f172a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:38,fontWeight:1000,boxShadow:'0 28px 75px rgba(0,0,0,.35)',transform:'translateY('+ease(f-i*8,[0,30],[65,0])+'px)',opacity:ease(f-i*8,[0,22],[0,1])}}>{x}</div>)}</div><Caption scene={scene}/></AbsoluteFill> }
function SaasVideo({data}) { return <AbsoluteFill><GlobalBg mode='saas'/><Audio src={staticFile(data.audioFile)}/>{data.scenes.map((s,i)=><Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationInFrames}><SaasScene scene={s} index={i}/></Sequence>)}<Progress/></AbsoluteFill> }

function DashScene({scene,index}) { const f=useCurrentFrame(); const zoom=1+Math.sin(f/48)*.018; const active=(index%4); const rows=['Queued task','Tool result','Review item','Audit entry','Video render']; return <AbsoluteFill style={{fontFamily:font}}><Top tag='Dashboard Demo'/><div style={{position:'absolute',left:42,right:42,top:128,bottom:110,borderRadius:44,background:'rgba(4,12,24,.94)',border:'1px solid rgba(103,232,249,.35)',boxShadow:'0 35px 110px rgba(0,0,0,.58)',overflow:'hidden',transform:'scale('+zoom+')'}}><div style={{height:72,display:'flex',alignItems:'center',gap:12,padding:'0 26px',borderBottom:'1px solid rgba(255,255,255,.1)'}}><span style={{width:18,height:18,borderRadius:9,background:red}}/><span style={{width:18,height:18,borderRadius:9,background:yellow}}/><span style={{width:18,height:18,borderRadius:9,background:'#4ade80'}}/><b style={{marginLeft:18,color:'#e0f2fe',fontSize:24}}>LocalAnt Control Center</b></div><div style={{position:'absolute',left:24,top:96,bottom:24,width:240,borderRadius:28,background:'rgba(15,23,42,.82)',padding:18}}>{['Tools','Queue','Approvals','Audit','Video'].map((x,i)=><div key={x} style={{height:72,marginBottom:12,borderRadius:18,background:i===active?'linear-gradient(90deg,'+neon+','+cyan+')':'rgba(255,255,255,.06)',color:i===active?'#031015':'#cbd5e1',display:'flex',alignItems:'center',paddingLeft:18,fontSize:22,fontWeight:1000}}>{x}</div>)}</div><div style={{position:'absolute',left:292,top:96,right:24,height:270,borderRadius:30,background:'rgba(255,255,255,.95)',padding:30,color:'#0f172a'}}><div style={{fontSize:24,fontWeight:1000,color:'#0f766e'}}>CURRENT VIEW</div><div style={{fontSize:46,fontWeight:1000,lineHeight:1.02,marginTop:16}}>{scene.title}</div><div style={{position:'absolute',right:28,bottom:28,width:136,height:136,borderRadius:34,background:'linear-gradient(135deg,#0f172a,#0f766e)',display:'flex',alignItems:'center',justifyContent:'center',color:neon,fontSize:54,fontWeight:1000}}>↗</div></div><div style={{position:'absolute',left:292,top:398,right:24,bottom:24,borderRadius:30,background:'rgba(2,6,23,.8)',padding:28}}>{rows.map((r,i)=>{const local=f-i*8; return <div key={r} style={{marginBottom:18,opacity:ease(local,[0,14],[0,1])}}><div style={{display:'flex',justifyContent:'space-between',color:'#d1fae5',fontSize:24,fontWeight:900}}><span>{r}</span><span>{i===active?'ACTIVE':'OK'}</span></div><div style={{height:10,marginTop:8,borderRadius:99,background:'rgba(255,255,255,.12)'}}><div style={{height:'100%',width:ease(local,[0,36],[10,100])+'%',borderRadius:99,background:'linear-gradient(90deg,'+neon+','+cyan+')'}}/></div></div>})}</div></div><Caption scene={scene}/></AbsoluteFill> }
function DashboardVideo({data}) { return <AbsoluteFill><GlobalBg mode='dashboard'/><Audio src={staticFile(data.audioFile)}/>{data.scenes.map((s,i)=><Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationInFrames}><DashScene scene={s} index={i}/></Sequence>)}<Progress/></AbsoluteFill> }

function DevScene({scene,index}) { const f=useCurrentFrame(); const code=['$ localant run plan','git diff --stat','pnpm test','browser.check()','adb shell screencap','write output.mp4']; const typed=ease(f,[0,42],[0,code.length]); return <AbsoluteFill style={{fontFamily:font}}><Top tag='Developer Tool'/><div style={{position:'absolute',left:58,right:58,top:150,color:'#e0f2fe'}}><div style={{fontSize:28,color:cyan,fontWeight:1000,letterSpacing:3}}>DEV WORKFLOW</div><div style={{fontSize:70,fontWeight:1000,lineHeight:1.0,marginTop:16}}>{scene.title}</div></div><div style={{position:'absolute',left:54,right:54,top:520,bottom:210,display:'grid',gridTemplateColumns:'1.05fr .95fr',gap:24}}><div style={{borderRadius:30,background:'rgba(0,0,0,.82)',border:'1px solid rgba(103,232,249,.35)',padding:26,boxShadow:'0 30px 80px rgba(0,0,0,.55)'}}><div style={{color:'#94a3b8',fontSize:22,fontWeight:900,marginBottom:18}}>terminal</div>{code.map((c,i)=><div key={c} style={{fontFamily:'Menlo, Monaco, monospace',fontSize:24,lineHeight:1.55,color:i<typed? (i%2? '#a7f3d0' : '#67e8f9') : 'rgba(255,255,255,.18)',fontWeight:800}}>{i<typed?c:'█'}</div>)}</div><div style={{borderRadius:30,background:'rgba(15,23,42,.86)',border:'1px solid rgba(57,255,136,.3)',padding:24}}><div style={{color:neon,fontSize:22,fontWeight:1000}}>file tree</div>{['src/','tools/','browser/','android/','video-studio/','output.mp4'].map((x,i)=><div key={x} style={{marginTop:18,fontSize:26,color:i===index%6?neon:'#dbeafe',fontWeight:900,transform:'translateX('+ease(f-i*6,[0,22],[30,0])+'px)',opacity:ease(f-i*6,[0,18],[0,1])}}>▸ {x}</div>)}</div></div><Caption scene={scene}/></AbsoluteFill> }
function DeveloperVideo({data}) { return <AbsoluteFill><GlobalBg mode='developer'/><Audio src={staticFile(data.audioFile)}/>{data.scenes.map((s,i)=><Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationInFrames}><DevScene scene={s} index={i}/></Sequence>)}<Progress/></AbsoluteFill> }

function SecScene({scene,index}) { const f=useCurrentFrame(); const meter=ease(f,[0,50],[0,88+(index%3)*4]); const cards=['Risk check','Human review','Audit trail','Tool policy']; return <AbsoluteFill style={{fontFamily:font}}><Top tag='Security Control'/><div style={{position:'absolute',left:64,right:64,top:145,color:'white'}}><div style={{fontSize:30,color:yellow,fontWeight:1000,letterSpacing:3}}>CONTROL LAYER</div><div style={{fontSize:72,fontWeight:1000,lineHeight:1.0,marginTop:16}}>{scene.title}</div></div><div style={{position:'absolute',left:70,right:70,top:530,height:300,borderRadius:36,background:'rgba(2,6,23,.86)',border:'1px solid rgba(250,204,21,.35)',padding:32,boxShadow:'0 35px 90px rgba(0,0,0,.55)'}}><div style={{display:'flex',justifyContent:'space-between',color:'#fef3c7',fontSize:28,fontWeight:1000}}><span>Safety score</span><span>{Math.round(meter)}%</span></div><div style={{height:28,borderRadius:999,background:'rgba(255,255,255,.12)',marginTop:24,overflow:'hidden'}}><div style={{height:'100%',width:meter+'%',background:'linear-gradient(90deg,'+red+','+yellow+','+neon+')'}}/></div><div style={{position:'absolute',right:30,bottom:30,fontSize:74,fontWeight:1000,color: index%2? yellow:neon}}>{index%2?'REVIEW':'SAFE'}</div></div><div style={{position:'absolute',left:72,right:72,top:880,display:'grid',gridTemplateColumns:'1fr 1fr',gap:22}}>{cards.map((x,i)=><div key={x} style={{height:150,borderRadius:28,background:i===index%4?'linear-gradient(135deg,#fef3c7,#bbf7d0)':'rgba(255,255,255,.92)',color:'#0f172a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:30,fontWeight:1000,boxShadow:'0 22px 65px rgba(0,0,0,.35)',opacity:ease(f-i*8,[0,18],[0,1])}}>{x}</div>)}</div><Caption scene={scene}/></AbsoluteFill> }
function SecurityVideo({data}) { return <AbsoluteFill><GlobalBg mode='security'/><Audio src={staticFile(data.audioFile)}/>{data.scenes.map((s,i)=><Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationInFrames}><SecScene scene={s} index={i}/></Sequence>)}<Progress/></AbsoluteFill> }

function MotionScene({scene,index}) { const f=useCurrentFrame(); const rot=f/2; const words=scene.label.split(' '); return <AbsoluteFill style={{fontFamily:font,alignItems:'center',justifyContent:'center'}}><Top tag='Motion Graphic'/><div style={{position:'absolute',width:760,height:760,borderRadius:380,border:'4px solid rgba(57,255,136,.32)',transform:'rotate('+rot+'deg)',boxShadow:'0 0 70px rgba(57,255,136,.25)'}}/><div style={{position:'absolute',width:560,height:560,borderRadius:280,border:'2px dashed rgba(103,232,249,.38)',transform:'rotate('+(-rot*1.2)+'deg)'}}/><div style={{zIndex:20,textAlign:'center',color:'white',padding:60}}><div style={{fontSize:44,fontWeight:1000,color:cyan,letterSpacing:3,opacity:ease(f,[0,18],[0,1])}}>0{index+1}</div><div style={{fontSize:88,lineHeight:.92,fontWeight:1000,letterSpacing:-4,marginTop:22,transform:'scale('+ease(f,[0,24],[.75,1])+')',opacity:ease(f,[0,20],[0,1])}}>{scene.title}</div><div style={{display:'flex',gap:14,flexWrap:'wrap',justifyContent:'center',marginTop:50}}>{words.map((w,i)=><span key={w+i} style={{fontSize:30,fontWeight:1000,color:i%2? '#031015':'#dcfce7',background:i%2? 'linear-gradient(90deg,'+neon+','+cyan+')':'rgba(255,255,255,.12)',padding:'13px 18px',borderRadius:999,opacity:ease(f-i*5,[0,16],[0,1]),transform:'translateY('+ease(f-i*5,[0,18],[32,0])+'px)'}}>{w}</span>)}</div></div><Caption scene={scene}/></AbsoluteFill> }
function MotionVideo({data}) { return <AbsoluteFill><GlobalBg mode='motion'/><Audio src={staticFile(data.audioFile)}/>{data.scenes.map((s,i)=><Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationInFrames}><MotionScene scene={s} index={i}/></Sequence>)}<Progress/></AbsoluteFill> }

function Video({data}) { if (data.style==='dashboard') return <DashboardVideo data={data}/>; if (data.style==='developer') return <DeveloperVideo data={data}/>; if (data.style==='security') return <SecurityVideo data={data}/>; if (data.style==='motion') return <MotionVideo data={data}/>; return <SaasVideo data={data}/>; }
function Root(){return <Composition id='LocalAntFiveStyles' component={Video} durationInFrames={DATA.durationInFrames} fps={30} width={1080} height={1920} defaultProps={{data: DATA}}/>}
registerRoot(Root);
`;
}

function writeSrt(scenes: RenderScene[], file: string) {
  const toTs = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };
  let cursor = 0;
  const blocks = scenes.map((scene, i) => {
    const start = cursor;
    const end = cursor + scene.durationSeconds;
    cursor = end;
    return `${i + 1}\n${toTs(start)} --> ${toTs(end)}\n${scene.label}\n`;
  });
  fs.writeFileSync(file, blocks.join("\n"));
}

async function renderVariant(variant: VariantSpec) {
  const dir = path.join(outRoot, variant.key);
  const publicDir = path.join(dir, "public");
  const outputDir = path.join(dir, "output");
  ensureDir(publicDir);
  ensureDir(outputDir);
  const audio = await prepareAudio(variant, dir);
  const scenes = audio.scenes;
  for (const s of scenes) fs.copyFileSync(path.join(dir, s.audioFile), path.join(publicDir, s.audioFile.split("/").pop()!));
  fs.copyFileSync(audio.narrationFile, path.join(publicDir, "narration.wav"));
  let totalFrames = Math.ceil(Math.max(70, audio.audioDurationSeconds + 8.0) * fps);
  const data = {
    key: variant.key,
    title: variant.title,
    style: variant.style,
    scenes,
    fps,
    width,
    height,
    audioFile: "narration.wav",
    audioDurationSeconds: audio.audioDurationSeconds,
    durationInFrames: totalFrames,
    durationSeconds: sec(totalFrames / fps),
  };
  const entryPoint = path.join(dir, "entry.tsx");
  fs.writeFileSync(entryPoint, entrySource(data));
  writeSrt(scenes, path.join(outputDir, "output.srt"));
  fs.writeFileSync(path.join(outputDir, "render-data.json"), JSON.stringify(data, null, 2));
  const serveUrl = await bundle({ entryPoint, publicDir, rootDir: dir, ignoreRegisterRootWarning: true, onProgress: () => undefined });
  const composition = await selectComposition({ serveUrl, id: "LocalAntFiveStyles", inputProps: { data }, logLevel: "error" });
  const outputPath = path.join(outputDir, "output.mp4");
  const thumbnailPath = path.join(outputDir, "thumbnail.jpg");
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: outputPath, inputProps: { data }, overwrite: true, logLevel: "error", concurrency: 4, crf: 28 });
  await renderStill({ composition, serveUrl, output: thumbnailPath, frame: Math.min(60, totalFrames - 1), inputProps: { data }, imageFormat: "jpeg", overwrite: true, logLevel: "error" });
  const actualDurationSeconds = sec(durationOf(outputPath));
  if (actualDurationSeconds + 0.15 < audio.audioDurationSeconds) throw new Error(`${variant.key}: audio would be cut`);
  return { key: variant.key, style: variant.style, title: variant.title, outputPath, thumbnailPath, durationSeconds: actualDurationSeconds, audioDurationSeconds: audio.audioDurationSeconds, fileSize: fs.statSync(outputPath).size, renderer: "remotion", voiceProvider: "voicevox" };
}

async function main() {
  ensureDir(outRoot);
  ensureDir(publicOutDir);
  const results = [];
  for (const variant of variants) {
    console.log(`rendering ${variant.key}...`);
    const result = await renderVariant(variant);
    const publicMp4 = path.join(publicOutDir, `${variant.key}.mp4`);
    const publicJpg = path.join(publicOutDir, `${variant.key}.jpg`);
    fs.copyFileSync(result.outputPath, publicMp4);
    fs.copyFileSync(result.thumbnailPath, publicJpg);
    results.push({ ...result, publicPath: publicMp4, publicThumbnailPath: publicJpg, publicUrl: `https://audio-manga-motivated-celebrities.trycloudflare.com/${variant.key}.mp4`, thumbnailUrl: `https://audio-manga-motivated-celebrities.trycloudflare.com/${variant.key}.jpg` });
  }
  const summary = { ok: true, generatedAt: new Date().toISOString(), results };
  fs.writeFileSync(path.join(outRoot, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
