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
  gw.saveConfig({ ...gw.config(), tools: { profile: "full" }, security: { ...gw.config().security, mode: "yolo" } });

  const script = await call(gw, "video_studio_create_script", {
    topic: "LocalAnt Video Studio free local rendering",
    language: "en",
    durationSeconds: 12,
    targetPlatform: "youtube",
  });
  const created = await call(gw, "video_studio_create_project", {
    title: script.title,
    description: script.description,
    script: script.script,
    scenes: script.scenes,
    hashtags: script.hashtags,
    language: "en",
    durationSeconds: 12,
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
    render.thumbnailPath,
    path.join(created.projectDir, "storyboard.json"),
    render.renderPlanPath,
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing E2E output: ${file}`);
  }
  if (!review.hasVideo) throw new Error("E2E output has no video stream.");
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
    durationSeconds: review.durationSeconds,
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
