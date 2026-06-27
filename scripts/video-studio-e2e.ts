import fs from "node:fs";
import path from "node:path";
import { createGateway } from "@localant/gateway";

async function call(gw: ReturnType<typeof createGateway>, name: string, input: Record<string, unknown> = {}) {
  const result = await gw.executeTool(name, input, { caller: "video-studio:e2e" });
  if (!result.ok) throw new Error(`${name}: ${result.error ?? JSON.stringify(result.approvalRequired)}`);
  return result.data as any;
}

async function main() {
  const outDir = path.join(process.cwd(), ".tmp-video-studio-e2e");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const home = path.join(outDir, "localant-home");
  const gw = createGateway(home);
  gw.saveConfig({
    ...gw.config(),
    tools: { ...gw.config().tools, profile: "full", features: { ...gw.config().tools.features, videoStudio: true } },
    security: { ...gw.config().security, mode: "yolo" },
  });

  const created = await call(gw, "video_studio_create_project", {
    title: "LocalAnt - ChatGPTの手をPCへ",
    description: "ChatGPTからローカルPCで作業するLocalAntのアプリ紹介CM。",
    script: [
      "ChatGPTの指示が、そのままローカルPCの作業になる。",
      "LocalAntは、ChatGPTとあなたのPCをつなぐアプリです。",
      "Shell、Git、ブラウザ、ADB、ファイル操作まで、ひとつの画面から。",
      "危険な操作は承認、すべての履歴は監査ログへ。",
      "さらに動画生成や投稿準備まで、制作フローをまとめて自動化。",
      "LocalAnt。ChatGPTの手を、あなたのPCへ。",
    ].join("\n"),
    scenes: [
      { id: "scene-001", index: 1, title: "ChatGPTの手をPCへ", narration: "ChatGPTの指示が、そのままローカルPCの作業になる。", visualPrompt: "premium app commercial hero, glowing network nodes, product reveal", onScreenText: "ChatGPT → LocalAnt → Local PC", durationSeconds: 6 },
      { id: "scene-002", index: 2, title: "LocalAnt", narration: "LocalAntは、ChatGPTとあなたのPCをつなぐアプリです。", visualPrompt: "app dashboard mock, product UI, SaaS promo", onScreenText: "ChatGPTとPCをつなぐアプリ", durationSeconds: 6 },
      { id: "scene-003", index: 3, title: "操作をまとめて", narration: "Shell、Git、ブラウザ、ADB、ファイル操作まで、ひとつの画面から。", visualPrompt: "feature cards, fast SaaS promo motion", onScreenText: "Shell / Git / Browser / ADB / Files", durationSeconds: 8 },
      { id: "scene-004", index: 4, title: "安全に進める", narration: "危険な操作は承認、すべての履歴は監査ログへ。", visualPrompt: "approval and audit dashboard, security commercial", onScreenText: "Approval / Risk Control / Audit Log", durationSeconds: 7 },
      { id: "scene-005", index: 5, title: "制作も自動化", narration: "さらに動画生成や投稿準備まで、制作フローをまとめて自動化。", visualPrompt: "workflow pipeline, app commercial arrows", onScreenText: "Script → Voice → Captions → Video → Publish", durationSeconds: 8 },
      { id: "scene-006", index: 6, title: "LocalAnt", narration: "LocalAnt。ChatGPTの手を、あなたのPCへ。", visualPrompt: "final app commercial CTA", onScreenText: "Build faster. Operate safer.", durationSeconds: 6 }
    ],
    hashtags: ["LocalAnt", "ChatGPT", "MCP", "AI開発", "アプリ紹介"],
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

  const required = [
    render.outputPath,
    captions.srtPath,
    captions.assPath,
    captions.wordsPath,
    render.thumbnailPath,
    path.join(created.projectDir, "storyboard.json"),
    render.renderPlanPath,
    path.join(created.projectDir, "render", "render-props.json"),
    path.join(created.projectDir, "render", "motion-plan.json"),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing E2E output: ${file}`);
  }
  if (!review.hasVideo) throw new Error("E2E output has no video stream.");
  if (!review.hasAudio) throw new Error("E2E output has no audio stream.");
  if (!review.ok) throw new Error(`E2E review failed: ${(review.warnings ?? []).join("; ")}`);
  if (review.width !== 1080 || review.height !== 1920) throw new Error(`Unexpected resolution: ${review.width}x${review.height}`);

  const result = {
    ok: true,
    projectId: created.project.id,
    projectDir: created.projectDir,
    outputPath: render.outputPath,
    thumbnailPath: render.thumbnailPath,
    captionsPath: captions.srtPath,
    assPath: captions.assPath,
    storyboardPath: path.join(created.projectDir, "storyboard.json"),
    renderPlanPath: render.renderPlanPath,
    renderPropsPath: path.join(created.projectDir, "render", "render-props.json"),
    motionPlanPath: path.join(created.projectDir, "render", "motion-plan.json"),
    renderer: render.renderer,
    durationSeconds: review.durationSeconds,
    audioDurationSeconds: review.audioDurationSeconds,
    width: review.width,
    height: review.height,
    hasAudio: review.hasAudio,
    hasVideo: review.hasVideo,
    assets,
    audio,
    publish,
  };
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
