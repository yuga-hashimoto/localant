import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Gateway } from "../gateway.js";

const execFileAsync = promisify(execFile);

const platforms = ["youtube", "tiktok", "instagram"] as const;
const providers = ["browser", "upload-post", "youtube-official", "tiktok-direct", "instagram-graph", "custom-command"] as const;
const secretNames = [
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "VOICEVOX_ENDPOINT",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_ACCESS_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "TIKTOK_ACCESS_TOKEN",
  "TIKTOK_REFRESH_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_USER_ID",
  "META_APP_ID",
  "META_APP_SECRET",
  "UPLOAD_POST_API_KEY",
] as const;

type Platform = (typeof platforms)[number];
type Provider = (typeof providers)[number];

interface VideoScene {
  id: string;
  index: number;
  title: string;
  narration: string;
  visualPrompt: string;
  onScreenText: string;
  durationSeconds: number;
  assetPath?: string;
  audioPath?: string;
  captionStart?: number;
  captionEnd?: number;
}

interface VideoProject {
  id: string;
  title: string;
  description: string;
  script: string;
  language: "ja" | "en";
  durationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetPlatforms: Platform[];
  scenes: VideoScene[];
  hashtags: string[];
  createdAt: string;
  updatedAt: string;
}

interface CreateProjectInput {
  title: string;
  description: string;
  script: string;
  language: "ja" | "en";
  durationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetPlatforms: Platform[];
  hashtags: string[];
  scenes: z.output<typeof sceneInput>[];
}

const sceneInput = z.object({
  id: z.string().optional(),
  index: z.number().int().positive().optional(),
  title: z.string().optional(),
  narration: z.string().optional(),
  visualPrompt: z.string().optional(),
  onScreenText: z.string().optional(),
  durationSeconds: z.number().positive().optional(),
}).passthrough();

const projectIdInput = z.object({ projectId: z.string().min(1) }).strip();
const platformSchema = z.enum(platforms);
const providerSchema = z.enum(providers);

export function registerVideoStudioTools(gw: Gateway): void {
  gw.registry.register({
    name: "video_studio_status",
    description: "Return Video Studio status, local renderer readiness, and secret presence without secret values.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => status(gw),
  });
  gw.registry.register({
    name: "video_studio_configure",
    description: "Configure Video Studio. Paid external video generation is not enabled by this tool.",
    risk: 2,
    inputSchema: z.object({ workspaceDir: z.string().optional(), renderer: z.enum(["builtin-ffmpeg", "remotion", "custom-command"]).optional() }).strip(),
    summarize: () => "configure Video Studio",
    auditInput: (i) => ({ ...i, secretValues: "not accepted" }),
    handler: (i) => configure(gw, i),
  });
  gw.registry.register({
    name: "video_studio_create_script",
    description: "Create a Shorts/Reels script without an LLM API.",
    risk: 2,
    inputSchema: z.object({
      topic: z.string().min(1),
      targetPlatform: platformSchema.default("youtube"),
      language: z.enum(["ja", "en"]).default("ja"),
      durationSeconds: z.number().int().min(6).max(180).default(30),
      tone: z.string().default("clear"),
      audience: z.string().default("general creators"),
    }).strip(),
    summarize: (i) => `create video script: ${i.topic}`,
    handler: (i) => createScript(i),
  });
  gw.registry.register({
    name: "video_studio_create_project",
    description: "Create a Video Studio project manifest, script, storyboard, directories, and run log.",
    risk: 2,
    inputSchema: z.object({
      title: z.string().min(1),
      description: z.string().default(""),
      script: z.string().min(1),
      language: z.enum(["ja", "en"]).default("ja"),
      durationSeconds: z.number().int().min(1).max(3600).default(30),
      aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
      targetPlatforms: z.array(platformSchema).default(["youtube", "tiktok", "instagram"]),
      hashtags: z.array(z.string()).default([]),
      scenes: z.array(sceneInput).default([]),
    }).strip(),
    summarize: (i) => `create Video Studio project: ${i.title}`,
    handler: (i) => createProject(gw, i),
  });
  gw.registry.register({
    name: "video_studio_list_projects",
    description: "List Video Studio projects.",
    risk: 0,
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(100) }).strip(),
    handler: (i) => listProjects(gw, i.limit),
  });
  gw.registry.register({ name: "video_studio_generate_assets", description: "Generate free local scene PNG assets.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio assets: ${i.projectId}`, handler: (i) => generateAssets(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_generate_audio", description: "Generate free local narration audio with macOS say or FFmpeg fallback.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio audio: ${i.projectId}`, handler: (i) => generateAudio(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_generate_captions", description: "Generate SRT, ASS, and word timing JSON captions.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio captions: ${i.projectId}`, handler: (i) => generateCaptions(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_render_video", description: "Render a local upload-ready MP4 with FFmpeg.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `render Video Studio project: ${i.projectId}`, handler: (i) => renderVideo(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_generate_video", description: "Run assets, audio, captions, render, review, and publish_prepare in one local free pipeline.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio project: ${i.projectId}`, handler: async (i) => generateVideo(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_review_video", description: "Review rendered video with ffprobe where available.", risk: 0, inputSchema: projectIdInput, handler: (i) => reviewVideo(gw, i.projectId) });
  gw.registry.register({
    name: "video_studio_publish_prepare",
    description: "Write platform metadata JSON files without network action.",
    risk: 2,
    inputSchema: projectIdInput.extend({ platforms: z.array(platformSchema).default(["youtube", "tiktok", "instagram"]) }).strip(),
    summarize: (i) => `prepare Video Studio publish metadata: ${i.projectId}`,
    handler: (i) => publishPrepare(gw, i.projectId, i.platforms),
  });
  gw.registry.register({
    name: "video_studio_publish_video",
    description: "Dry-run or prepare a browser/manual publish action. Risk 4 for real publishing.",
    risk: 4,
    inputSchema: projectIdInput.extend({
      platform: platformSchema,
      provider: providerSchema.default("browser"),
      dryRun: z.boolean().default(true),
      confirmBrowserPublish: z.boolean().default(false),
      endpoint: z.string().url().optional(),
    }).strip(),
    summarize: (i) => `${i.dryRun ? "dry-run" : "prepare"} ${i.platform} publish`,
    auditInput: (i) => ({ ...i, secretValues: "not accepted" }),
    handler: (i) => publishVideo(gw, i),
  });
  gw.registry.register({ name: "video_studio_open_setup", description: "Return setup URL/instructions for Video Studio providers.", risk: 3, inputSchema: z.object({ platform: z.enum([...platforms, "generator", "upload-post"] as const) }).strip(), summarize: (i) => `open setup: ${i.platform}`, handler: (i) => openSetup(i.platform) });
  gw.registry.register({ name: "video_studio_connect_account", description: "Return account connection guidance without bypassing login, CAPTCHA, or 2FA.", risk: 3, inputSchema: z.object({ platform: platformSchema, provider: providerSchema.default("browser") }).strip(), summarize: (i) => `connect ${i.platform}`, handler: (i) => connectAccount(i.platform, i.provider) });
  gw.registry.register({ name: "video_studio_test_publisher", description: "Check publisher readiness without uploading.", risk: 1, inputSchema: z.object({ platform: platformSchema, provider: providerSchema.default("browser") }).strip(), handler: (i) => testPublisher(gw, i.platform, i.provider) });
  gw.registry.register({
    name: "browser_upload_file",
    description: "Prepare a Playwright file-upload action for a LocalAnt Video Studio output file.",
    risk: 3,
    inputSchema: z.object({ selector: z.string().min(1), path: z.string().min(1), dryRun: z.boolean().default(true) }).strip(),
    summarize: (i) => `upload file into ${i.selector}`,
    handler: (i) => browserUploadFile(gw, i),
  });
}

function videoRoot(gw: Gateway): string {
  return path.join(gw.paths.root, "video-studio");
}

function projectsRoot(gw: Gateway): string {
  return path.join(videoRoot(gw), "projects");
}

function projectDir(gw: Gateway, projectId: string): string {
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error("Invalid projectId.");
  return path.join(projectsRoot(gw), projectId);
}

function loadProject(gw: Gateway, projectId: string): { project: VideoProject; dir: string } {
  const dir = projectDir(gw, projectId);
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) throw new Error(`Video Studio project not found: ${projectId}`);
  return { project: JSON.parse(fs.readFileSync(file, "utf8")) as VideoProject, dir };
}

function saveProject(dir: string, project: VideoProject): void {
  project.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(project, null, 2));
  fs.writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify({ projectId: project.id, scenes: project.scenes }, null, 2));
}

function ensureProjectDirs(dir: string): void {
  for (const rel of ["assets", "audio", "captions", "output", "render"]) fs.mkdirSync(path.join(dir, rel), { recursive: true });
}

function appendRun(dir: string, event: string, data: unknown): void {
  fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify({ time: new Date().toISOString(), event, data }) + "\n");
}

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function status(gw: Gateway) {
  const [ffmpeg, ffprobe, say] = await Promise.all([hasCommand("ffmpeg"), hasCommand("ffprobe"), hasCommand("say")]);
  return {
    ok: true,
    root: videoRoot(gw),
    renderer: { builtinFfmpeg: ffmpeg, ffprobe },
    audio: { macosSay: say, ffmpegSilenceFallback: ffmpeg },
    policy: {
      videoGeneration: "free local generation only; paid external video generation APIs are not used",
      defaultRenderer: "builtin-ffmpeg",
      paidVideoApisEnabled: false,
    },
    secrets: secretNames.map((name) => ({ name, present: gw.vault.get(name) !== undefined })),
  };
}

function configure(gw: Gateway, input: { workspaceDir?: string; renderer?: string }) {
  fs.mkdirSync(videoRoot(gw), { recursive: true });
  fs.writeFileSync(path.join(videoRoot(gw), "config.json"), JSON.stringify({ ...input, paidVideoApisEnabled: false }, null, 2));
  return { ok: true, configPath: path.join(videoRoot(gw), "config.json"), paidVideoApisEnabled: false };
}

function createScript(input: { topic: string; targetPlatform: Platform; language: "ja" | "en"; durationSeconds: number; tone: string; audience: string }) {
  const count = Math.max(2, Math.min(6, Math.round(input.durationSeconds / 6)));
  const per = Math.max(2, Math.round(input.durationSeconds / count));
  const title = input.language === "ja" ? `${input.topic}を60秒で理解する` : `Understand ${input.topic} in 60 seconds`;
  const hooks = input.language === "ja"
    ? [`最初に結論です。${input.topic}は、制作の手戻りを減らす仕組みです。`, `次に流れです。台本、素材、音声、字幕、動画を順番に作ります。`, `最後に確認です。投稿前にレビューして、必要ならブラウザでアップロードを補助します。`]
    : [`Here is the point: ${input.topic} reduces production handoff work.`, `The flow is script, assets, audio, captions, and render.`, `Before publishing, review the result and use browser upload assist.`];
  const scenes: VideoScene[] = Array.from({ length: count }, (_, idx) => {
    const text = hooks[idx % hooks.length] ?? input.topic;
    return {
      id: `scene-${String(idx + 1).padStart(3, "0")}`,
      index: idx + 1,
      title: input.language === "ja" ? `シーン ${idx + 1}` : `Scene ${idx + 1}`,
      narration: text,
      visualPrompt: `${input.topic}, ${input.tone}, ${input.targetPlatform}, local video studio`,
      onScreenText: text.length > 42 ? `${text.slice(0, 42)}...` : text,
      durationSeconds: per,
    };
  });
  const script = scenes.map((s) => `## ${s.title}\n${s.narration}`).join("\n\n");
  return {
    title,
    description: input.language === "ja" ? `${input.topic}についてのショート動画です。` : `A short video about ${input.topic}.`,
    script,
    hashtags: input.language === "ja" ? ["#LocalAnt", "#動画制作", "#自動化"] : ["#LocalAnt", "#VideoAutomation", "#Shorts"],
    scenes,
  };
}

function createProject(gw: Gateway, input: CreateProjectInput) {
  const id = `${Date.now().toString(36)}-${slug(input.title).slice(0, 28) || "video"}`;
  const dir = projectDir(gw, id);
  ensureProjectDirs(dir);
  const now = new Date().toISOString();
  const scenes = normalizeScenes(input.scenes, input.durationSeconds, input.script);
  const project: VideoProject = {
    id,
    title: input.title,
    description: input.description,
    script: input.script,
    language: input.language,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    targetPlatforms: input.targetPlatforms,
    scenes,
    hashtags: input.hashtags,
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(path.join(dir, "script.md"), input.script);
  saveProject(dir, project);
  appendRun(dir, "project.created", { id });
  return { project, projectDir: dir };
}

function normalizeScenes(raw: z.output<typeof sceneInput>[], duration: number, script: string): VideoScene[] {
  const fallback = script.split(/\n+/).filter(Boolean).slice(0, 3);
  const source: Array<Partial<VideoScene>> = raw.length ? raw : fallback.map((line, idx) => ({ title: `Scene ${idx + 1}`, narration: line, onScreenText: line }));
  const per = Math.max(1, Math.round(duration / Math.max(1, source.length)));
  return source.map((s, idx) => ({
    id: s.id ?? `scene-${String(idx + 1).padStart(3, "0")}`,
    index: s.index ?? idx + 1,
    title: s.title ?? `Scene ${idx + 1}`,
    narration: s.narration ?? s.onScreenText ?? `Scene ${idx + 1}`,
    visualPrompt: s.visualPrompt ?? s.title ?? `Scene ${idx + 1}`,
    onScreenText: s.onScreenText ?? s.narration ?? s.title ?? `Scene ${idx + 1}`,
    durationSeconds: s.durationSeconds ?? per,
  }));
}

function listProjects(gw: Gateway, limit: number) {
  const root = projectsRoot(gw);
  if (!fs.existsSync(root)) return { projects: [] };
  const projects = fs.readdirSync(root).flatMap((id) => {
    const file = path.join(root, id, "manifest.json");
    if (!fs.existsSync(file)) return [];
    return [JSON.parse(fs.readFileSync(file, "utf8")) as VideoProject];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  return { projects };
}

async function generateAssets(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  const size = dimensions(project.aspectRatio);
  const ffmpeg = await hasCommand("ffmpeg");
  const assets = [];
  for (const scene of project.scenes) {
    const png = path.join(dir, "assets", `${scene.id}.png`);
    const svg = path.join(dir, "assets", `${scene.id}.svg`);
    fs.writeFileSync(svg, sceneSvg(scene, size.width, size.height));
    if (ffmpeg) {
      try {
        await execFileAsync("ffmpeg", ["-y", "-i", svg, "-frames:v", "1", png]);
      } catch {
        const color = ["#15324a", "#20514f", "#5a3c2c", "#3b315d", "#315034"][(scene.index - 1) % 5];
        await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=${size.width}x${size.height}:d=0.1`, "-frames:v", "1", png]);
      }
    } else {
      fs.writeFileSync(png, "");
    }
    scene.assetPath = png;
    assets.push({ sceneId: scene.id, path: png, svgPath: svg });
  }
  saveProject(dir, project);
  appendRun(dir, "assets.generated", { count: assets.length, freeLocal: true });
  return { ok: true, assets };
}

async function generateAudio(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  const ffmpeg = await hasCommand("ffmpeg");
  const say = process.platform === "darwin" && await hasCommand("say");
  if (!ffmpeg && !say) return { ok: false, setupRequired: true, reason: "Install ffmpeg or use macOS say to generate local free audio." };
  const listFile = path.join(dir, "audio", "concat.txt");
  const list: string[] = [];
  for (const scene of project.scenes) {
    const wav = path.join(dir, "audio", `${scene.id}.wav`);
    if (say && ffmpeg) {
      const aiff = path.join(dir, "audio", `${scene.id}.aiff`);
      await execFileAsync("say", ["-v", project.language === "ja" ? "Kyoko" : "Samantha", "-o", aiff, scene.narration]);
      await execFileAsync("ffmpeg", ["-y", "-i", aiff, "-ar", "44100", "-ac", "2", wav]);
    } else if (ffmpeg) {
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(scene.durationSeconds), wav]);
    }
    scene.audioPath = wav;
    list.push(`file '${wav.replace(/'/g, "'\\''")}'`);
  }
  fs.writeFileSync(listFile, list.join("\n"));
  const narration = path.join(dir, "audio", "narration.wav");
  if (ffmpeg) {
    const rawNarration = path.join(dir, "audio", "narration-raw.wav");
    await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", rawNarration]);
    await execFileAsync("ffmpeg", ["-y", "-i", rawNarration, "-af", "apad", "-t", String(project.durationSeconds), narration]);
  }
  saveProject(dir, project);
  appendRun(dir, "audio.generated", { narration, engine: say ? "macos-say" : "ffmpeg-silence", freeLocal: true });
  return { ok: true, engine: say ? "macos-say" : "ffmpeg-silence", narrationPath: narration, setupRequired: false };
}

async function generateCaptions(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  let cursor = 0;
  const srt: string[] = [];
  const assEvents: string[] = [];
  const words: unknown[] = [];
  for (const scene of project.scenes) {
    const start = cursor;
    const end = cursor + scene.durationSeconds;
    scene.captionStart = start;
    scene.captionEnd = end;
    srt.push(String(scene.index), `${srtTime(start)} --> ${srtTime(end)}`, scene.onScreenText, "");
    assEvents.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${assEscape(scene.onScreenText)}`);
    const chunks = scene.narration.split(/\s+/).filter(Boolean);
    const step = scene.durationSeconds / Math.max(1, chunks.length);
    chunks.forEach((word, idx) => words.push({ word, start: start + idx * step, end: start + (idx + 1) * step, sceneId: scene.id }));
    cursor = end;
  }
  const srtPath = path.join(dir, "captions", "output.srt");
  const assPath = path.join(dir, "captions", "output.ass");
  const wordsPath = path.join(dir, "captions", "words.json");
  fs.writeFileSync(srtPath, srt.join("\n"));
  fs.writeFileSync(assPath, ass(project, assEvents));
  fs.writeFileSync(wordsPath, JSON.stringify({ projectId, words }, null, 2));
  saveProject(dir, project);
  appendRun(dir, "captions.generated", { srtPath, assPath, wordsPath });
  return { ok: true, srtPath, assPath, wordsPath };
}

async function renderVideo(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  if (!await hasCommand("ffmpeg")) return { ok: false, setupRequired: true, reason: "ffmpeg is required for local free rendering." };
  if (!fs.existsSync(path.join(dir, "captions", "output.ass"))) await generateCaptions(gw, projectId);
  if (!project.scenes.every((s) => s.assetPath && fs.existsSync(s.assetPath))) await generateAssets(gw, projectId);
  const clips: string[] = [];
  for (const scene of project.scenes) {
    const clip = path.join(dir, "render", `${scene.id}.mp4`);
    await execFileAsync("ffmpeg", ["-y", "-loop", "1", "-t", String(scene.durationSeconds), "-i", scene.assetPath!, "-vf", `scale=${dimensions(project.aspectRatio).width}:${dimensions(project.aspectRatio).height},format=yuv420p`, "-r", "30", "-an", clip]);
    clips.push(clip);
  }
  const concat = path.join(dir, "render", "concat.txt");
  fs.writeFileSync(concat, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"));
  const videoNoAudio = path.join(dir, "render", "video-no-audio.mp4");
  await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", videoNoAudio]);
  const outputPath = path.join(dir, "output", "output.mp4");
  const thumb = path.join(dir, "output", "thumbnail.jpg");
  const audio = path.join(dir, "audio", "narration.wav");
  const vf = `drawbox=x=0:y=0:w=iw*t/${project.durationSeconds}:h=8:color=0x39ff88@0.9:t=fill`;
  const args = fs.existsSync(audio)
    ? ["-y", "-i", videoNoAudio, "-i", audio, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", outputPath]
    : ["-y", "-i", videoNoAudio, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", outputPath];
  await execFileAsync("ffmpeg", args);
  await execFileAsync("ffmpeg", ["-y", "-i", outputPath, "-frames:v", "1", thumb]);
  const plan = {
    projectId,
    ...dimensions(project.aspectRatio),
    fps: 30,
    scenes: project.scenes,
    audio: { path: fs.existsSync(audio) ? audio : null },
    captions: { srtPath: path.join(dir, "captions", "output.srt"), assPath: path.join(dir, "captions", "output.ass"), burnIn: "scene-image-text" },
    outputPath,
    thumbnailPath: thumb,
  };
  const renderPlanPath = path.join(dir, "render", "render-plan.json");
  fs.writeFileSync(renderPlanPath, JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, "render", "ffmpeg-command.txt"), `ffmpeg ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  appendRun(dir, "video.rendered", { outputPath, thumbnailPath: thumb });
  return { ok: true, outputPath, thumbnailPath: thumb, renderPlanPath, ffmpegCommandPath: path.join(dir, "render", "ffmpeg-command.txt") };
}

async function reviewVideo(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  const outputPath = path.join(dir, "output", "output.mp4");
  const thumbnailPath = path.join(dir, "output", "thumbnail.jpg");
  const captionsPath = path.join(dir, "captions", "output.srt");
  const assPath = path.join(dir, "captions", "output.ass");
  const renderPlanPath = path.join(dir, "render", "render-plan.json");
  const base = { outputPath, thumbnailPath, captionsPath, assPath, storyboardPath: path.join(dir, "storyboard.json"), renderPlanPath };
  if (!fs.existsSync(outputPath)) return { ok: false, ...base, durationSeconds: 0, width: 0, height: 0, hasVideo: false, hasAudio: false, warnings: ["output.mp4 does not exist"] };
  if (!await hasCommand("ffprobe")) return { ok: true, ...base, durationSeconds: project.durationSeconds, ...dimensions(project.aspectRatio), hasVideo: true, hasAudio: fs.existsSync(path.join(dir, "audio", "narration.wav")), warnings: ["ffprobe not available"] };
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", outputPath]);
  const probe = JSON.parse(stdout);
  const video = (probe.streams ?? []).find((s: any) => s.codec_type === "video");
  const hasAudio = (probe.streams ?? []).some((s: any) => s.codec_type === "audio");
  const durationSeconds = Number(probe.format?.duration ?? 0);
  const warnings = [];
  if (Math.abs(durationSeconds - project.durationSeconds) > 3) warnings.push("duration differs from project duration");
  return { ok: Boolean(video), ...base, durationSeconds, width: video?.width ?? 0, height: video?.height ?? 0, hasVideo: Boolean(video), hasAudio, warnings };
}

async function generateVideo(gw: Gateway, projectId: string) {
  const assets = await generateAssets(gw, projectId);
  const audio = await generateAudio(gw, projectId);
  const captions = await generateCaptions(gw, projectId);
  const render = await renderVideo(gw, projectId);
  const review = await reviewVideo(gw, projectId);
  const publish = await publishPrepare(gw, projectId, ["youtube", "tiktok", "instagram"]);
  return { ok: review.ok, assets, audio, captions, render, review, publish };
}

async function publishPrepare(gw: Gateway, projectId: string, targetPlatforms: Platform[]) {
  const { project, dir } = loadProject(gw, projectId);
  const metadata: Record<string, unknown> = {};
  for (const platform of targetPlatforms) {
    const data = {
      title: project.title,
      description: `${project.description}\n\n${project.hashtags.join(" ")}`.trim(),
      file: path.join(dir, "output", "output.mp4"),
      thumbnail: path.join(dir, "output", "thumbnail.jpg"),
      tags: project.hashtags.map((h) => h.replace(/^#/, "")),
      publishMode: "manual-review-first",
    };
    metadata[platform] = data;
    fs.writeFileSync(path.join(dir, "output", `metadata-${platform}.json`), JSON.stringify(data, null, 2));
  }
  appendRun(dir, "publish.prepared", { platforms: targetPlatforms });
  return { ok: true, metadata };
}

async function publishVideo(gw: Gateway, input: { projectId: string; platform: Platform; provider: Provider; dryRun: boolean; confirmBrowserPublish: boolean; endpoint?: string }) {
  const { dir } = loadProject(gw, input.projectId);
  const prepared = await publishPrepare(gw, input.projectId, [input.platform]);
  const outputPath = path.join(dir, "output", "output.mp4");
  if (input.dryRun) return { ok: true, dryRun: true, networkCalled: false, outputPath, prepared };
  if (input.provider === "browser") {
    return { ok: true, dryRun: false, provider: "browser", networkCalled: false, outputPath, uploadUrl: setupUrl(input.platform), stoppedBeforeSubmit: !input.confirmBrowserPublish, note: "Open the upload URL, select the file, fill metadata, and stop before submit unless confirmBrowserPublish=true." };
  }
  if (input.provider === "upload-post") {
    const key = gw.vault.get("UPLOAD_POST_API_KEY");
    if (!key) return { ok: false, setupRequired: true, networkCalled: false, reason: "UPLOAD_POST_API_KEY is not configured." };
    const endpoint = input.endpoint ?? process.env.LOCALANT_UPLOAD_POST_ENDPOINT;
    if (!endpoint) return { ok: false, setupRequired: true, networkCalled: false, reason: "Set LOCALANT_UPLOAD_POST_ENDPOINT for UploadPostProvider." };
    const resp = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ platform: input.platform, file: outputPath }) });
    return { ok: resp.ok, networkCalled: true, status: resp.status };
  }
  return { ok: false, setupRequired: true, networkCalled: false, reason: `${input.provider} requires official account/OAuth review setup.` };
}

function openSetup(platform: string) {
  return { ok: true, platform, url: setupUrl(platform), note: "LocalAnt does not bypass login, CAPTCHA, 2FA, or platform review." };
}

function connectAccount(platform: Platform, provider: Provider) {
  return { ok: true, platform, provider, setupRequired: provider !== "browser", url: setupUrl(platform), note: "Use browser setup or official OAuth credentials. No CAPTCHA/2FA bypass is attempted." };
}

function testPublisher(gw: Gateway, platform: Platform, provider: Provider) {
  const secret = provider === "upload-post" ? "UPLOAD_POST_API_KEY" : platform === "youtube" ? "YOUTUBE_ACCESS_TOKEN" : platform === "tiktok" ? "TIKTOK_ACCESS_TOKEN" : "INSTAGRAM_ACCESS_TOKEN";
  return { ok: true, platform, provider, ready: provider === "browser" || gw.vault.get(secret) !== undefined, requiredSecret: provider === "browser" ? null : secret };
}

function browserUploadFile(gw: Gateway, input: { selector: string; path: string; dryRun: boolean }) {
  if (!path.isAbsolute(input.path)) throw new Error("browser_upload_file requires an absolute LocalAnt workspace path.");
  const root = videoRoot(gw);
  const resolved = path.resolve(input.path);
  if (!isWithin(root, resolved)) throw new Error("Path traversal rejected: upload files must stay inside the LocalAnt Video Studio workspace.");
  if (!fs.existsSync(resolved)) throw new Error(`Upload file does not exist: ${resolved}`);
  return { ok: true, dryRun: input.dryRun, selector: input.selector, path: resolved, note: "Use Playwright setInputFiles in the browser publisher; this tool does not click submit." };
}

function dimensions(aspect: VideoProject["aspectRatio"]) {
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function sceneSvg(scene: VideoScene, width: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#142033"/>
<rect x="64" y="${Math.round(height * 0.12)}" width="${width - 128}" height="${Math.round(height * 0.76)}" fill="none" stroke="#39ff88" stroke-width="4" opacity="0.45"/>
<text x="72" y="${Math.round(height * 0.2)}" fill="#ffffff" font-size="56" font-family="Arial">${xmlEscape(scene.title)}</text>
<text x="72" y="${Math.round(height * 0.72)}" fill="#ffffff" font-size="42" font-family="Arial">${xmlEscape(scene.onScreenText)}</text>
</svg>
`;
}

function ass(project: VideoProject, events: string[]) {
  const { width, height } = dimensions(project.aspectRatio);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H0039FF88,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,6,2,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

function srtTime(sec: number) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(x).padStart(3, "0")}`;
}

function assTime(sec: number) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const x = cs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${String(x).padStart(2, "0")}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function assEscape(s: string) {
  return s.replace(/[{}]/g, "").replace(/\n/g, "\\N");
}

function xmlEscape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function setupUrl(platform: string) {
  if (platform === "youtube") return "https://studio.youtube.com/";
  if (platform === "tiktok") return "https://www.tiktok.com/upload";
  if (platform === "instagram") return "https://www.instagram.com/";
  return "https://localant.local/video-studio/setup";
}

function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
