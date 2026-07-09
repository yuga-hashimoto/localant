import fs from "node:fs";
import path from "node:path";
import { createGateway } from "@localant/gateway";

async function call(gw: ReturnType<typeof createGateway>, name: string, input: Record<string, unknown> = {}) {
  const result = await gw.executeTool(name, input, { caller: "video-studio:variants" });
  if (!result.ok) throw new Error(`${name}: ${result.error ?? JSON.stringify(result.approvalRequired)}`);
  return result.data as any;
}

const variants = [
  {
    key: "saas-cm",
    title: "LocalAnt - ChatGPTの手をPCへ",
    description: "LocalAntのSaaSアプリCM風ショート動画。",
    hashtags: ["LocalAnt", "ChatGPT", "MCP", "AI開発", "アプリ紹介"],
    script: [
      "ChatGPTの指示が、そのままローカルPCの作業になる。",
      "LocalAntは、ChatGPTとあなたのPCをつなぐアプリです。",
      "Shell、Git、ブラウザ、ADB、ファイル操作まで、ひとつの画面から。",
      "危険な操作は承認、すべての履歴は監査ログへ。",
      "さらに動画生成や投稿準備まで、制作フローをまとめて自動化。",
      "LocalAnt。ChatGPTの手を、あなたのPCへ。",
    ],
    scenes: [
      { id: "scene-001", index: 1, title: "ChatGPTの手をPCへ", narration: "ChatGPTの指示が、そのままローカルPCの作業になる。", visualPrompt: "premium app commercial hero", onScreenText: "ChatGPT → LocalAnt → Local PC", durationSeconds: 6 },
      { id: "scene-002", index: 2, title: "LocalAnt", narration: "LocalAntは、ChatGPTとあなたのPCをつなぐアプリです。", visualPrompt: "product UI reveal", onScreenText: "ChatGPTとPCをつなぐアプリ", durationSeconds: 6 },
      { id: "scene-003", index: 3, title: "操作をまとめて", narration: "Shell、Git、ブラウザ、ADB、ファイル操作まで、ひとつの画面から。", visualPrompt: "feature cards", onScreenText: "Shell / Git / Browser / ADB / Files", durationSeconds: 8 },
      { id: "scene-004", index: 4, title: "安全に進める", narration: "危険な操作は承認、すべての履歴は監査ログへ。", visualPrompt: "approval dashboard", onScreenText: "Approval / Risk Control / Audit Log", durationSeconds: 7 },
      { id: "scene-005", index: 5, title: "制作も自動化", narration: "さらに動画生成や投稿準備まで、制作フローをまとめて自動化。", visualPrompt: "workflow pipeline", onScreenText: "Script → Voice → Captions → Video → Publish", durationSeconds: 8 },
      { id: "scene-006", index: 6, title: "LocalAnt", narration: "LocalAnt。ChatGPTの手を、あなたのPCへ。", visualPrompt: "final CTA", onScreenText: "Build faster. Operate safer.", durationSeconds: 6 },
    ],
  },
  {
    key: "developer-demo",
    title: "LocalAnt - 開発作業をChatGPTから",
    description: "開発者向けにLocalAntのワークフローを見せるデモ風ショート動画。",
    hashtags: ["LocalAnt", "開発効率化", "ChatGPT", "MCP", "自動化"],
    script: [
      "コード修正、ブラウザ確認、端末操作。全部、ChatGPTから始められます。",
      "LocalAntは、ローカルPCの作業を安全に実行するMCPブリッジです。",
      "変更内容はログに残り、危険な操作は承認待ちになります。",
      "開発、検証、記事作成、動画生成まで、作業の流れを止めません。",
      "ChatGPTを、開発環境につながる作業アシスタントへ。",
    ],
    scenes: [
      { id: "scene-001", index: 1, title: "開発作業をChatGPTから", narration: "コード修正、ブラウザ確認、端末操作。全部、ChatGPTから始められます。", visualPrompt: "developer demo intro", onScreenText: "Code / Browser / Terminal", durationSeconds: 8 },
      { id: "scene-002", index: 2, title: "MCPブリッジ", narration: "LocalAntは、ローカルPCの作業を安全に実行するMCPブリッジです。", visualPrompt: "mcp bridge diagram", onScreenText: "ChatGPT ↔ LocalAnt ↔ Local PC", durationSeconds: 7 },
      { id: "scene-003", index: 3, title: "安心して実行", narration: "変更内容はログに残り、危険な操作は承認待ちになります。", visualPrompt: "audit and approval", onScreenText: "Log everything. Approve risky actions.", durationSeconds: 7 },
      { id: "scene-004", index: 4, title: "作業を止めない", narration: "開発、検証、記事作成、動画生成まで、作業の流れを止めません。", visualPrompt: "workflow dashboard", onScreenText: "Dev → Test → Article → Video", durationSeconds: 8 },
      { id: "scene-005", index: 5, title: "LocalAnt", narration: "ChatGPTを、開発環境につながる作業アシスタントへ。", visualPrompt: "developer CTA", onScreenText: "Your local AI operator", durationSeconds: 6 },
    ],
  },
  {
    key: "short-ad",
    title: "LocalAnt - もうPC操作を手でやらない",
    description: "短尺広告向けの強フック版LocalAnt紹介動画。",
    hashtags: ["LocalAnt", "AI自動化", "ChatGPT", "作業効率化"],
    script: [
      "もう、全部手で操作しなくていい。",
      "ChatGPTに頼むだけで、LocalAntがローカルPCで作業を進めます。",
      "ブラウザ、Git、ファイル、Android操作までまとめて自動化。",
      "危険な操作は止めて、ログは全部残す。",
      "LocalAnt。ChatGPTに、実行する力を。",
    ],
    scenes: [
      { id: "scene-001", index: 1, title: "もう手でやらない", narration: "もう、全部手で操作しなくていい。", visualPrompt: "strong hook ad", onScreenText: "手作業を、AIへ。", durationSeconds: 4 },
      { id: "scene-002", index: 2, title: "頼むだけ", narration: "ChatGPTに頼むだけで、LocalAntがローカルPCで作業を進めます。", visualPrompt: "fast product reveal", onScreenText: "Ask ChatGPT. LocalAnt executes.", durationSeconds: 7 },
      { id: "scene-003", index: 3, title: "まとめて自動化", narration: "ブラウザ、Git、ファイル、Android操作までまとめて自動化。", visualPrompt: "rapid feature cards", onScreenText: "Browser / Git / Files / Android", durationSeconds: 7 },
      { id: "scene-004", index: 4, title: "安全に", narration: "危険な操作は止めて、ログは全部残す。", visualPrompt: "security badge", onScreenText: "Stop risky actions. Keep audit logs.", durationSeconds: 6 },
      { id: "scene-005", index: 5, title: "LocalAnt", narration: "LocalAnt。ChatGPTに、実行する力を。", visualPrompt: "ad CTA", onScreenText: "ChatGPTに、実行する力を。", durationSeconds: 5 },
    ],
  },
];

async function main() {
  const outDir = path.join(process.cwd(), ".tmp-video-studio-variants");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const home = path.join(outDir, "localant-home");
  const gw = createGateway(home);
  gw.saveConfig({ ...gw.config(), tools: { profile: "full" }, security: { ...gw.config().security, mode: "yolo" } });

  const results = [];
  for (const variant of variants) {
    const created = await call(gw, "video_studio_create_project", {
      title: variant.title,
      description: variant.description,
      script: variant.script.join("\n"),
      scenes: variant.scenes,
      hashtags: variant.hashtags,
      language: "ja",
      durationSeconds: 45,
      targetPlatforms: ["youtube", "tiktok", "instagram"],
    });
    const assets = await call(gw, "video_studio_generate_assets", { projectId: created.project.id });
    const audio = await call(gw, "video_studio_generate_audio", { projectId: created.project.id });
    const captions = await call(gw, "video_studio_generate_captions", { projectId: created.project.id });
    const render = await call(gw, "video_studio_render_video", { projectId: created.project.id });
    const review = await call(gw, "video_studio_review_video", { projectId: created.project.id });
    const publish = await call(gw, "video_studio_publish_prepare", { projectId: created.project.id, platforms: ["youtube", "tiktok", "instagram"] });
    if (!review.ok) throw new Error(`${variant.key}: ${JSON.stringify(review.warnings)}`);
    results.push({ key: variant.key, projectId: created.project.id, projectDir: created.projectDir, outputPath: render.outputPath, thumbnailPath: render.thumbnailPath, renderer: render.renderer, durationSeconds: review.durationSeconds, audioDurationSeconds: review.audioDurationSeconds, width: review.width, height: review.height, hasAudio: review.hasAudio, hasVideo: review.hasVideo, audio, assets, publish });
  }
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ ok: true, results }, null, 2));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
