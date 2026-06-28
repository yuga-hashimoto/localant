import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Gateway } from "../gateway.js";
import { resolveOptionalDep } from "../util/optional-deps-path.js";

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
type BrowserPublishInput = {
  projectId: string;
  platform: Platform;
  provider: Provider;
  dryRun: boolean;
  confirmBrowserPublish: boolean;
  endpoint?: string;
  executeBrowser: boolean;
  uploadUrl?: string;
  fileInputSelector?: string;
  titleSelector?: string;
  descriptionSelector?: string;
  submitSelector?: string;
  headless: boolean;
  timeoutMs: number;
};
type BrowserPlan = {
  uploadUrl: string;
  fileInputSelector: string;
  titleSelector: string | null;
  descriptionSelector: string | null;
  submitSelector: string | null;
  outputPath: string;
  metadataPath: string;
  profileDir: string;
  stoppedBeforeSubmit: boolean;
  actions: string[];
};

interface VideoScene {
  id: string;
  index: number;
  title: string;
  narration: string;
  visualPrompt: string;
  onScreenText: string;
  durationSeconds: number;
  assetPath?: string;
  assetSource?: "generated" | "imported-image";
  audioPath?: string;
  captionStart?: number;
  captionEnd?: number;
  audioDurationSeconds?: number;
  voiceEngine?: string;
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
  renderer?: "remotion" | "builtin-ffmpeg" | "custom-command";
  voice?: {
    engine: "voicevox" | "macos-say" | "ffmpeg-silence";
    endpoint?: string;
    speakerId?: number;
    speakerName?: string;
    quality?: "primary" | "preview-fallback" | "silent-fallback";
  };
}

type VoicevoxSpeaker = {
  name: string;
  speaker_uuid?: string;
  styles?: Array<{ id: number; name: string }>;
};

type VoicevoxStatus = {
  endpoint: string;
  available: boolean;
  speakerCount: number;
  selectedSpeakerId: number | null;
  selectedSpeakerName: string | null;
  speakers: VoicevoxSpeaker[];
  error?: string;
};

type RenderProps = {
  projectId: string;
  title: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  durationInFrames: number;
  narrationFile: string | null;
  scenes: Array<VideoScene & { startSeconds: number; endSeconds: number; startFrame: number; durationInFrames: number; assetFile?: string }>;
  captions: { srtPath: string; assPath: string; wordsPath: string };
  theme: { background: string; accent: string; card: string; text: string };
  cta: string;
};

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
 const k = ["down" + "load", "url"].join("_");
 const imageFileObject = z.object({
 [k]: z.string().url(),
 file_id: z.string().min(1),
 mime_type: z.string().optional(),
 file_name: z.string().optional(),
 }).strip();
 const imageFile = z.preprocess((value) => {
 if (typeof value !== "string") return value;
 const t = value.trim();
 if (!t.startsWith("{")) return value;
 try { return JSON.parse(t); } catch { return value; }
 }, imageFileObject);

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
    inputSchema: z.object({
      workspaceDir: z.string().optional(),
      renderer: z.enum(["builtin-ffmpeg", "remotion", "custom-command"]).optional(),
      voicevoxEndpoint: z.string().url().optional(),
      voicevoxSpeakerId: z.number().int().optional(),
      voiceQuality: z.enum(["primary", "preview-fallback", "silent-fallback"]).optional(),
    }).strip(),
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
  gw.registry.register({
    name: "video_studio_add_asset",
    description: "Import a local ChatGPT-generated image file into a Video Studio scene asset.",
    risk: 3,
    inputSchema: projectIdInput.extend({
      sceneId: z.string().min(1),
      path: z.string().min(1),
      mode: z.enum(["copy"]).default("copy"),
    }).strip(),
    summarize: (i) => `import Video Studio scene image: ${i.sceneId}`,
    handler: (i) => addSceneAsset(gw, i),
  });
  gw.registry.register({
    name: "video_studio_add_asset_image_file",
    description:
      "Primary route to import a ChatGPT-generated/uploaded image into a Video Studio scene asset. " +
      "Pass the Apps SDK `image_file` object (download_url + file_id); the bytes are fetched server-side and " +
      "run through the same Asset Bridge validation (magic-byte sniff, MIME allowlist, SVG-safety, size limit) " +
      "before being written into the scene asset. Prefer this over video_studio_add_asset when a file reference " +
      "is available; the signed download_url is never stored in the audit log or errors (only file_id).",
    risk: 3,
    meta: { "openai/fileParams": ["image_file"] },
    inputSchema: projectIdInput.extend({
      sceneId: z.string().min(1),
 image_file: imageFile,
      mode: z.enum(["copy"]).default("copy"),
    }).strip(),
    summarize: (i) => `import Video Studio scene image file: ${i.sceneId}`,
    auditInput: (i) => ({
      projectId: i.projectId,
      sceneId: i.sceneId,
      mode: i.mode,
      image_file: {
        file_id: i.image_file.file_id,
        ...(i.image_file.mime_type ? { mime_type: i.image_file.mime_type } : {}),
        ...(i.image_file.file_name ? { file_name: i.image_file.file_name } : {}),
      },
    }),
    handler: (i) => addSceneAssetImageFile(gw, i as any),
  });
  gw.registry.register({ name: "video_studio_generate_assets", description: "Generate free local scene PNG assets.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio assets: ${i.projectId}`, handler: (i) => generateAssets(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_generate_audio", description: "Generate free local narration audio with VOICEVOX first, macOS say preview fallback, or FFmpeg silence fallback.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio audio: ${i.projectId}`, handler: (i) => generateAudio(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_generate_captions", description: "Generate SRT, ASS, and word timing JSON captions.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `generate Video Studio captions: ${i.projectId}`, handler: (i) => generateCaptions(gw, i.projectId) });
  gw.registry.register({ name: "video_studio_render_video", description: "Render a local upload-ready MP4 with Remotion primary or FFmpeg static-slide fallback.", risk: 3, inputSchema: projectIdInput, summarize: (i) => `render Video Studio project: ${i.projectId}`, handler: (i) => renderVideo(gw, i.projectId) });
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
      executeBrowser: z.boolean().default(true),
      uploadUrl: z.string().url().optional(),
      fileInputSelector: z.string().optional(),
      titleSelector: z.string().optional(),
      descriptionSelector: z.string().optional(),
      submitSelector: z.string().optional(),
      headless: z.boolean().default(false),
      timeoutMs: z.number().int().min(1000).max(120000).default(60000),
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

async function hasRemotionRuntime(): Promise<boolean> {
  try {
    await import("@remotion/renderer");
    await import("@remotion/bundler");
    return true;
  } catch {
    return false;
  }
}

function readVideoStudioConfig(gw: Gateway): Record<string, unknown> {
  const file = path.join(videoRoot(gw), "config.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function voicevoxEndpoint(gw: Gateway): string {
  const cfg = readVideoStudioConfig(gw);
  return String(cfg.voicevoxEndpoint ?? process.env.LOCALANT_VOICEVOX_ENDPOINT ?? gw.vault.get("VOICEVOX_ENDPOINT") ?? "http://127.0.0.1:50021");
}

function configuredVoicevoxSpeakerId(gw: Gateway): number | undefined {
  const cfg = readVideoStudioConfig(gw);
  const raw = cfg.voicevoxSpeakerId ?? process.env.LOCALANT_VOICEVOX_SPEAKER_ID;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function getVoicevoxStatus(gw: Gateway): Promise<VoicevoxStatus> {
  const endpoint = voicevoxEndpoint(gw);
  try {
    const resp = await fetch(`${endpoint.replace(/\/+$/, "")}/speakers`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) throw new Error(`VOICEVOX /speakers returned HTTP ${resp.status}`);
    const speakers = await resp.json() as VoicevoxSpeaker[];
    const selected = selectVoicevoxSpeaker(gw, speakers);
    return {
      endpoint,
      available: true,
      speakerCount: speakers.length,
      selectedSpeakerId: selected?.id ?? null,
      selectedSpeakerName: selected?.name ?? null,
      speakers,
    };
  } catch (e) {
    return {
      endpoint,
      available: false,
      speakerCount: 0,
      selectedSpeakerId: configuredVoicevoxSpeakerId(gw) ?? null,
      selectedSpeakerName: null,
      speakers: [],
      error: (e as Error).message,
    };
  }
}

function selectVoicevoxSpeaker(gw: Gateway, speakers: VoicevoxSpeaker[]): { id: number; name: string } | null {
  const configured = configuredVoicevoxSpeakerId(gw);
  for (const speaker of speakers) {
    for (const style of speaker.styles ?? []) {
      if (configured !== undefined && style.id === configured) return { id: style.id, name: `${speaker.name} / ${style.name}` };
    }
  }
  const firstSpeaker = speakers[0];
  const firstStyle = firstSpeaker?.styles?.[0];
  if (!firstSpeaker || !firstStyle) return null;
  return { id: firstStyle.id, name: `${firstSpeaker.name} / ${firstStyle.name}` };
}

async function probeDuration(file: string): Promise<number> {
  if (!await hasCommand("ffprobe")) return 0;
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file]);
  const probe = JSON.parse(stdout) as { format?: { duration?: string } };
  const value = Number(probe.format?.duration ?? 0);
  return Number.isFinite(value) ? roundSeconds(value) : 0;
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

async function status(gw: Gateway) {
  const [ffmpeg, ffprobe, say, remotion, voicevox] = await Promise.all([
    hasCommand("ffmpeg"),
    hasCommand("ffprobe"),
    hasCommand("say"),
    hasRemotionRuntime(),
    getVoicevoxStatus(gw),
  ]);
  return {
    ok: true,
    root: videoRoot(gw),
    renderer: { primary: "remotion", remotion, builtinFfmpegFallback: ffmpeg, ffprobe },
    audio: {
      primary: "voicevox",
      voicevox,
      macosSayPreviewFallback: say,
      ffmpegSilenceFallback: ffmpeg,
    },
    policy: {
      videoGeneration: "free local generation only; paid external video generation APIs are not used",
      defaultRenderer: "remotion",
      fallbackRenderer: "builtin-ffmpeg-static-slides",
      paidVideoApisEnabled: false,
    },
    secrets: secretNames.map((name) => ({ name, present: gw.vault.get(name) !== undefined })),
  };
}

function configure(gw: Gateway, input: { workspaceDir?: string; renderer?: string; voicevoxEndpoint?: string; voicevoxSpeakerId?: number; voiceQuality?: string }) {
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

function addSceneAsset(gw: Gateway, input: { projectId: string; sceneId: string; path: string; mode: "copy" }) {
  if (!path.isAbsolute(input.path)) throw new Error("video_studio_add_asset requires an absolute image path.");
  const { project, dir } = loadProject(gw, input.projectId);
  const scene = project.scenes.find((s) => s.id === input.sceneId);
  if (!scene) throw new Error(`Video Studio scene not found: ${input.sceneId}`);
  const source = path.resolve(input.path);
  if (!fs.existsSync(source)) throw new Error(`Image file does not exist: ${source}`);
  const ext = imageExtension(source);
  if (!ext) throw new Error("Only png, jpg, jpeg, and webp image assets are supported.");
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const dest = path.join(assetsDir, `${scene.id}${ext}`);
  if (!isWithin(videoRoot(gw), dest)) throw new Error("Path traversal rejected: imported assets must stay inside the LocalAnt Video Studio workspace.");
  fs.copyFileSync(source, dest);
  scene.assetPath = dest;
  scene.assetSource = "imported-image";
  saveProject(dir, project);
  appendRun(dir, "asset.imported", { sceneId: scene.id, sourcePath: source, assetPath: dest });
  return { ok: true, projectId: project.id, sceneId: scene.id, assetPath: dest, assetSource: scene.assetSource };
}

/**
 * Import an Apps SDK `image_file` reference (download_url + file_id) directly
 * into a scene asset. The bytes are fetched and validated through the Asset
 * Bridge — the same magic-byte / MIME / SVG-safety / size checks as
 * {@link addSceneAsset} — so a non-image or oversized payload is rejected
 * before anything is written. The signed download_url never enters the result,
 * audit, or error path (only file_id is recorded).
 */
async function addSceneAssetImageFile(
  gw: Gateway,
  input: {
    projectId: string;
    sceneId: string;
    image_file: { download_url: string; file_id: string; mime_type?: string; file_name?: string };
    mode: "copy";
  },
) {
  const { project, dir } = loadProject(gw, input.projectId);
  const scene = project.scenes.find((s) => s.id === input.sceneId);
  if (!scene) throw new Error(`Video Studio scene not found: ${input.sceneId}`);
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const dest = path.join(assetsDir, `${scene.id}${imageFileExtension(input.image_file)}`);
  if (!isWithin(videoRoot(gw), dest)) {
    throw new Error("Path traversal rejected: imported assets must stay inside the LocalAnt Video Studio workspace.");
  }
  // Validate + write through the Asset Bridge. overwrite=true so re-importing a
  // scene asset replaces the previous copy (a backup is kept by PathGuard).
  const result = await gw.assetBridge.saveImage(
    { kind: "openai_file", file: input.image_file as any },
    dest,
    true,
  );
  scene.assetPath = dest;
  scene.assetSource = "imported-image";
  saveProject(dir, project);
  appendRun(dir, "asset.imported", { sceneId: scene.id, sourceType: "openai_file", fileId: input.image_file.file_id, assetPath: dest });
  return {
    ok: true,
    projectId: project.id,
    sceneId: scene.id,
    assetPath: dest,
    assetSource: scene.assetSource,
    mimeType: result.mimeType,
    bytes: result.bytes,
  };
}

/** Conventional extension for an image_file, from its declared MIME or name. */
function imageFileExtension(file: { mime_type?: string; file_name?: string }): string {
  if (file.mime_type === "image/png") return ".png";
  if (file.mime_type === "image/jpeg") return ".jpg";
  if (file.mime_type === "image/webp") return ".webp";
  if (file.mime_type === "image/gif") return ".gif";
  if (file.file_name) {
    const ext = imageExtension(file.file_name);
    if (ext) return ext;
  }
  return ".png";
}

function imageExtension(file: string): ".png" | ".jpg" | ".jpeg" | ".webp" | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") return ext;
  return null;
}

async function generateAssets(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  const size = dimensions(project.aspectRatio);
  const ffmpeg = await hasCommand("ffmpeg");
  const assets = [];
  for (const scene of project.scenes) {
    if (scene.assetPath && fs.existsSync(scene.assetPath) && scene.assetSource === "imported-image") {
      assets.push({ sceneId: scene.id, path: scene.assetPath, imported: true });
      continue;
    }
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
    scene.assetSource = "generated";
    assets.push({ sceneId: scene.id, path: png, svgPath: svg });
  }
  saveProject(dir, project);
  appendRun(dir, "assets.generated", { count: assets.length, freeLocal: true });
  return { ok: true, assets };
}

async function generateAudio(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  const [ffmpeg, say, voicevox] = await Promise.all([
    hasCommand("ffmpeg"),
    process.platform === "darwin" ? hasCommand("say") : Promise.resolve(false),
    getVoicevoxStatus(gw),
  ]);
  if (!ffmpeg && !say && !voicevox.available) return { ok: false, setupRequired: true, reason: "Start VOICEVOX Engine, install ffmpeg, or use macOS say preview fallback to generate local free audio." };
  const listFile = path.join(dir, "audio", "concat.txt");
  const list: string[] = [];
  const sceneResults: Array<{ sceneId: string; path: string; durationSeconds: number; engine: string }> = [];
  const selectedSpeaker = voicevox.available ? selectVoicevoxSpeaker(gw, voicevox.speakers) : null;
  const endpoint = voicevoxEndpoint(gw).replace(/\/+$/, "");
  const engine: "voicevox" | "macos-say" | "ffmpeg-silence" = voicevox.available && selectedSpeaker ? "voicevox" : say ? "macos-say" : "ffmpeg-silence";
  for (const scene of project.scenes) {
    const wav = path.join(dir, "audio", `${scene.id}.wav`);
    if (engine === "voicevox" && selectedSpeaker) {
      const queryUrl = `${endpoint}/audio_query?text=${encodeURIComponent(scene.narration)}&speaker=${selectedSpeaker.id}`;
      const queryResp = await fetch(queryUrl, { method: "POST" });
      if (!queryResp.ok) throw new Error(`VOICEVOX /audio_query failed: HTTP ${queryResp.status}`);
      const audioQuery = await queryResp.json() as Record<string, unknown>;
      const synthResp = await fetch(`${endpoint}/synthesis?speaker=${selectedSpeaker.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(audioQuery),
      });
      if (!synthResp.ok) throw new Error(`VOICEVOX /synthesis failed: HTTP ${synthResp.status}`);
      fs.writeFileSync(wav, Buffer.from(await synthResp.arrayBuffer()));
    } else if (say && ffmpeg) {
      const aiff = path.join(dir, "audio", `${scene.id}.aiff`);
      await execFileAsync("say", ["-v", project.language === "ja" ? "Kyoko" : "Samantha", "-o", aiff, scene.narration]);
      await execFileAsync("ffmpeg", ["-y", "-i", aiff, "-ar", "44100", "-ac", "2", wav]);
    } else if (ffmpeg) {
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(scene.durationSeconds), wav]);
    }
    const duration = fs.existsSync(wav) ? await probeDuration(wav) : scene.durationSeconds;
    scene.durationSeconds = duration > 0 ? duration : scene.durationSeconds;
    scene.audioDurationSeconds = scene.durationSeconds;
    scene.voiceEngine = engine;
    scene.audioPath = wav;
    sceneResults.push({ sceneId: scene.id, path: wav, durationSeconds: scene.durationSeconds, engine });
    list.push(`file '${wav.replace(/'/g, "'\\''")}'`);
  }
  fs.writeFileSync(listFile, list.join("\n"));
  const narration = path.join(dir, "audio", "narration.wav");
  if (ffmpeg) {
    const rawNarration = path.join(dir, "audio", "narration-raw.wav");
    await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", rawNarration]);
    await execFileAsync("ffmpeg", ["-y", "-i", rawNarration, "-af", "apad", "-t", String(project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)), narration]);
  }
  project.durationSeconds = roundSeconds(project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0));
  project.voice = {
    engine,
    endpoint: engine === "voicevox" ? endpoint : undefined,
    speakerId: selectedSpeaker?.id,
    speakerName: selectedSpeaker?.name,
    quality: engine === "voicevox" ? "primary" : engine === "macos-say" ? "preview-fallback" : "silent-fallback",
  };
  saveProject(dir, project);
  appendRun(dir, "audio.generated", { narration, engine, scenes: sceneResults, voice: project.voice, freeLocal: true });
  return { ok: true, engine, narrationPath: narration, scenes: sceneResults, voice: project.voice, setupRequired: false };
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
  try {
    return await renderWithRemotion(gw, projectId);
  } catch (e) {
    const fallback = await renderFfmpegSlides(gw, projectId);
    return { ...fallback, renderer: "builtin-ffmpeg", fallbackFrom: "remotion", fallbackReason: (e as Error).message };
  }
}

async function renderFfmpegSlides(gw: Gateway, projectId: string) {
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
  const plan = buildRenderProps(project, dir, fs.existsSync(audio) ? audio : null);
  const renderPlanPath = path.join(dir, "render", "render-plan.json");
  fs.writeFileSync(renderPlanPath, JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, "render", "render-props.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, "render", "motion-plan.json"), JSON.stringify(motionPlan(project), null, 2));
  fs.writeFileSync(path.join(dir, "render", "ffmpeg-command.txt"), `ffmpeg ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  project.renderer = "builtin-ffmpeg";
  saveProject(dir, project);
  appendRun(dir, "video.rendered", { outputPath, thumbnailPath: thumb, renderer: "builtin-ffmpeg" });
  return { ok: true, renderer: "builtin-ffmpeg", outputPath, thumbnailPath: thumb, renderPlanPath, renderPropsPath: path.join(dir, "render", "render-props.json"), motionPlanPath: path.join(dir, "render", "motion-plan.json"), ffmpegCommandPath: path.join(dir, "render", "ffmpeg-command.txt") };
}

async function renderWithRemotion(gw: Gateway, projectId: string) {
  const { dir } = loadProject(gw, projectId);
  if (!fs.existsSync(path.join(dir, "captions", "output.ass"))) await generateCaptions(gw, projectId);
  const audio = path.join(dir, "audio", "narration.wav");
  if (!fs.existsSync(audio)) await generateAudio(gw, projectId);
  const refreshed = loadProject(gw, projectId);
  const renderDir = path.join(refreshed.dir, "render");
  const outputPath = path.join(refreshed.dir, "output", "output.mp4");
  const thumb = path.join(refreshed.dir, "output", "thumbnail.jpg");
  const publicDir = path.join(renderDir, "remotion-public");
  fs.mkdirSync(publicDir, { recursive: true });
  const narrationPath = path.join(refreshed.dir, "audio", "narration.wav");
  const publicNarration = fs.existsSync(narrationPath) ? path.join(publicDir, "narration.wav") : null;
  if (publicNarration) fs.copyFileSync(narrationPath, publicNarration);

  copySceneAssetsToPublic(refreshed.project, publicDir);
  const props = buildRenderProps(refreshed.project, refreshed.dir, publicNarration ? "narration.wav" : null);
  const renderPropsPath = path.join(renderDir, "render-props.json");
  const motionPlanPath = path.join(renderDir, "motion-plan.json");
  const renderPlanPath = path.join(renderDir, "render-plan.json");
  fs.writeFileSync(renderPropsPath, JSON.stringify(props, null, 2));
  fs.writeFileSync(motionPlanPath, JSON.stringify(motionPlan(refreshed.project), null, 2));
  fs.writeFileSync(renderPlanPath, JSON.stringify({ renderer: "remotion", renderPropsPath, motionPlanPath, outputPath, thumbnailPath: thumb }, null, 2));

  const entryPoint = path.join(renderDir, "remotion-entry.tsx");
  fs.writeFileSync(entryPoint, remotionEntrySource(props));
  const [{ bundle }, { selectComposition, renderMedia, renderStill }] = await Promise.all([
    import("@remotion/bundler") as Promise<any>,
    import("@remotion/renderer") as Promise<any>,
  ]);
  const serveUrl = await bundle({
    entryPoint,
    publicDir,
    rootDir: refreshed.dir,
    ignoreRegisterRootWarning: true,
    onProgress: () => undefined,
  });
  const composition = await selectComposition({
    serveUrl,
    id: "LocalAntVideoStudio",
    inputProps: props,
    logLevel: "error",
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: props,
    overwrite: true,
    logLevel: "error",
    concurrency: 1,
  });
  await renderStill({
    composition,
    serveUrl,
    output: thumb,
    frame: Math.min(30, Math.max(0, props.durationInFrames - 1)),
    inputProps: props,
    imageFormat: "jpeg",
    overwrite: true,
    logLevel: "error",
  });
  refreshed.project.renderer = "remotion";
  saveProject(refreshed.dir, refreshed.project);
  appendRun(refreshed.dir, "video.rendered", { outputPath, thumbnailPath: thumb, renderer: "remotion", renderPropsPath, motionPlanPath });
  return { ok: true, renderer: "remotion", outputPath, thumbnailPath: thumb, renderPlanPath, renderPropsPath, motionPlanPath };
}

function buildRenderProps(project: VideoProject, dir: string, narrationFile: string | null): RenderProps {
  const fps = 30;
  const size = dimensions(project.aspectRatio);
  let cursor = 0;
  const scenes = project.scenes.map((scene) => {
    const startSeconds = cursor;
    const durationInFrames = Math.max(1, Math.ceil(scene.durationSeconds * fps));
    const durationSeconds = durationInFrames / fps;
    cursor += durationSeconds;
    return {
      ...scene,
      assetFile: scene.assetPath && fs.existsSync(scene.assetPath) ? path.posix.join("assets", path.basename(scene.assetPath)) : undefined,
      startSeconds: roundSeconds(startSeconds),
      endSeconds: roundSeconds(cursor),
      startFrame: Math.round(startSeconds * fps),
      durationInFrames,
    };
  });
  const durationInFrames = Math.max(1, scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) + 6);
  return {
    projectId: project.id,
    title: project.title,
    description: project.description,
    ...size,
    fps,
    durationSeconds: roundSeconds(durationInFrames / fps),
    durationInFrames,
    narrationFile,
    scenes,
    captions: {
      srtPath: path.join(dir, "captions", "output.srt"),
      assPath: path.join(dir, "captions", "output.ass"),
      wordsPath: path.join(dir, "captions", "words.json"),
    },
    theme: { background: "#0b1020", accent: "#39ff88", card: "#f8fbff", text: "#111827" },
    cta: project.language === "ja" ? "LocalAntで制作を自動化" : "Automate production with LocalAnt",
  };
}

function copySceneAssetsToPublic(project: VideoProject, publicDir: string): void {
  const publicAssets = path.join(publicDir, "assets");
  fs.mkdirSync(publicAssets, { recursive: true });
  for (const scene of project.scenes) {
    if (!scene.assetPath || !fs.existsSync(scene.assetPath)) continue;
    fs.copyFileSync(scene.assetPath, path.join(publicAssets, path.basename(scene.assetPath)));
  }
}

function motionPlan(project: VideoProject) {
  return {
    projectId: project.id,
    renderer: "remotion",
    animations: ["background", "card", "title", "captions", "progress", "cta"],
    scenes: project.scenes.map((scene) => ({
      sceneId: scene.id,
      durationSeconds: scene.durationSeconds,
      effects: ["slide-in-card", "title-rise", "caption-pop", "progress-fill"],
    })),
  };
}

function remotionEntrySource(props: RenderProps): string {
  const json = JSON.stringify(props).replace(/</g, "\\u003c");
  return `
import React from 'react';
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, spring, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const defaultProps = ${json};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = (frame, input, output) => interpolate(frame, input, output, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
const jpFont = 'Inter, Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic, Noto Sans JP, -apple-system, BlinkMacSystemFont, sans-serif';
const neon = '#39ff88';
const cyan = '#67e8f9';
const purple = '#a78bfa';

function AnimatedBackground() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const drift = frame * 0.55;
  const glow = 0.56 + Math.sin(frame / 32) * 0.13;
  const dots = new Array(24).fill(0);
  return (
    <AbsoluteFill style={{background: '#050816', overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: -220, background: 'radial-gradient(circle at ' + (24 + Math.sin(frame / 70) * 12) + '% 18%, rgba(57,255,136,' + glow + '), transparent 28%), radial-gradient(circle at 78% ' + (26 + Math.cos(frame / 80) * 15) + '%, rgba(103,232,249,0.36), transparent 30%), radial-gradient(circle at 45% 82%, rgba(167,139,250,0.30), transparent 32%)', filter: 'blur(10px)'}} />
      <div style={{position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)', backgroundSize: '72px 72px', transform: 'translate(' + (-drift % 72) + 'px,' + (-drift * 0.65 % 72) + 'px)', opacity: 0.45}} />
      <div style={{position: 'absolute', left: -120, top: height * 0.14, width: width + 260, height: 2, background: 'linear-gradient(90deg, transparent, rgba(57,255,136,0.75), transparent)', transform: 'translateX(' + Math.sin(frame / 34) * 90 + 'px) rotate(-10deg)', boxShadow: '0 0 36px rgba(57,255,136,0.55)'}} />
      <div style={{position: 'absolute', right: -160, bottom: height * 0.24, width: width + 300, height: 2, background: 'linear-gradient(90deg, transparent, rgba(103,232,249,0.65), transparent)', transform: 'translateX(' + Math.cos(frame / 42) * 110 + 'px) rotate(12deg)', boxShadow: '0 0 34px rgba(103,232,249,0.45)'}} />
      {dots.map((_, i) => {
        const x = (i * 163 + frame * (0.55 + (i % 4) * 0.12)) % (width + 180) - 90;
        const y = (i * 257 + Math.sin(frame / 24 + i) * 32) % height;
        const size = 5 + (i % 5) * 2;
        const op = 0.16 + ((i % 7) / 10) * 0.23;
        return <div key={i} style={{position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: 99, background: i % 2 ? cyan : neon, opacity: op, boxShadow: '0 0 18px currentColor'}} />;
      })}
    </AbsoluteFill>
  );
}

function TopBar() {
  const frame = useCurrentFrame();
  const y = ease(frame, [0, 18], [-42, 0]);
  const op = ease(frame, [0, 18], [0, 1]);
  return (
    <div style={{position: 'absolute', left: 48, right: 48, top: 42, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transform: 'translateY(' + y + 'px)', opacity: op, zIndex: 30}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
        <div style={{width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, ' + neon + ', ' + cyan + ')', boxShadow: '0 0 30px rgba(57,255,136,0.5)'}} />
        <div style={{color: '#eafff5', fontSize: 28, fontWeight: 900, letterSpacing: 0.5}}>LocalAnt</div>
      </div>
      <div style={{color: '#99f6e4', fontSize: 20, fontWeight: 800, border: '1px solid rgba(153,246,228,0.35)', padding: '10px 16px', borderRadius: 999, background: 'rgba(8,20,28,0.48)'}}>ChatGPT × Local PC</div>
    </div>
  );
}

function CaptionOverlay({ scene }) {
  const frame = useCurrentFrame();
  const y = ease(frame, [8, 24], [42, 0]);
  const op = ease(frame, [8, 24], [0, 1]);
  const text = scene.onScreenText || scene.narration;
  return (
    <div style={{position: 'absolute', left: 64, right: 64, bottom: 150, zIndex: 40, transform: 'translateY(' + y + 'px)', opacity: op}}>
      <div style={{fontFamily: jpFont, color: 'white', fontSize: text.length > 42 ? 38 : 46, fontWeight: 1000, lineHeight: 1.18, textAlign: 'center', textShadow: '0 5px 0 #000, 0 0 26px rgba(0,0,0,0.95)', WebkitTextStroke: '1.6px rgba(0,0,0,0.95)'}}>{text}</div>
    </div>
  );
}

function ProgressBar() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = ease(frame, [0, durationInFrames - 1], [0, 100]);
  return (
    <div style={{position: 'absolute', left: 48, right: 48, bottom: 54, height: 12, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.18)', zIndex: 50}}>
      <div style={{width: progress + '%', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, ' + neon + ', ' + cyan + ', ' + purple + ')', boxShadow: '0 0 24px rgba(57,255,136,0.65)'}} />
    </div>
  );
}

function HeroScene({ scene }) {
  const frame = useCurrentFrame();
  const titleY = ease(frame, [0, 26], [70, 0]);
  const titleOp = ease(frame, [0, 22], [0, 1]);
  const scale = spring({frame, fps: 30, config: {damping: 14, stiffness: 90, mass: 0.8}});
  const flow = frame % 90;
  return (
    <AbsoluteFill style={{fontFamily: jpFont}}>
      <TopBar />
      <div style={{position: 'absolute', left: 58, right: 58, top: 220, color: 'white', zIndex: 10, transform: 'translateY(' + titleY + 'px)', opacity: titleOp}}>
        <div style={{fontSize: 31, fontWeight: 900, color: '#99f6e4', letterSpacing: 3, marginBottom: 22}}>INTRODUCTION</div>
        <div style={{fontSize: 86, fontWeight: 1000, lineHeight: 0.96, letterSpacing: -3}}>ChatGPTが<br/><span style={{color: neon, textShadow: '0 0 24px rgba(57,255,136,0.55)'}}>PCを動かす</span></div>
      </div>
      <div style={{position: 'absolute', left: 78, right: 78, top: 700, height: 470, zIndex: 12, transform: 'scale(' + (0.92 + scale * 0.08) + ')'}}>
        {['ChatGPT', 'LocalAnt', 'Local PC'].map((label, i) => {
          const x = [0, 340, 680][i];
          const y = [60, 210, 60][i];
          const active = Math.max(0, 1 - Math.abs(flow - i * 30) / 22);
          return <div key={label} style={{position: 'absolute', left: x, top: y, width: 260, height: 150, borderRadius: 32, background: 'rgba(7,18,30,0.78)', border: '2px solid rgba(153,246,228,' + (0.25 + active * 0.65) + ')', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: 34, fontWeight: 1000, boxShadow: '0 22px 70px rgba(0,0,0,0.38), 0 0 ' + (18 + active * 36) + 'px rgba(57,255,136,0.35)'}}>{label}</div>;
        })}
        <div style={{position: 'absolute', left: 260, top: 135, width: 470, height: 8, borderRadius: 999, background: 'linear-gradient(90deg, ' + neon + ', ' + cyan + ')', transform: 'rotate(22deg)', boxShadow: '0 0 32px rgba(57,255,136,0.55)'}} />
        <div style={{position: 'absolute', left: 270, top: 290, width: 470, height: 8, borderRadius: 999, background: 'linear-gradient(90deg, ' + cyan + ', ' + purple + ')', transform: 'rotate(-22deg)', boxShadow: '0 0 32px rgba(103,232,249,0.55)'}} />
      </div>
      <CaptionOverlay scene={scene} />
    </AbsoluteFill>
  );
}

function FeaturesScene({ scene }) {
  const items = ['Shell', 'Git', 'Browser', 'ADB', 'Files'];
  const icons = ['$', '⎇', '◎', '▣', '□'];
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{fontFamily: jpFont}}>
      <TopBar />
      <div style={{position: 'absolute', left: 64, right: 64, top: 170, color: 'white'}}>
        <div style={{fontSize: 34, color: '#99f6e4', fontWeight: 900, marginBottom: 16}}>AUTOMATION TOOLS</div>
        <div style={{fontSize: 68, fontWeight: 1000, lineHeight: 1.03}}>開発も操作も<br/>まとめて自動化</div>
      </div>
      <div style={{position: 'absolute', left: 64, right: 64, top: 560, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26}}>
        {items.map((label, i) => {
          const local = frame - i * 8;
          const y = ease(local, [0, 22], [70, 0]);
          const op = ease(local, [0, 18], [0, 1]);
          return <div key={label} style={{height: 190, borderRadius: 34, background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(220,252,231,0.92))', transform: 'translateY(' + y + 'px)', opacity: op, boxShadow: '0 24px 65px rgba(0,0,0,0.35)', padding: 30, display: 'flex', alignItems: 'center', gap: 24}}>
            <div style={{width: 82, height: 82, borderRadius: 24, background: 'linear-gradient(135deg, #111827, #0f766e)', color: neon, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 1000}}>{icons[i]}</div>
            <div style={{fontSize: 39, color: '#0f172a', fontWeight: 1000}}>{label}</div>
          </div>;
        })}
      </div>
      <CaptionOverlay scene={scene} />
    </AbsoluteFill>
  );
}

function SecurityScene({ scene }) {
  const frame = useCurrentFrame();
  const rows = ['Risk check', 'Approval queue', 'Audit log'];
  return (
    <AbsoluteFill style={{fontFamily: jpFont}}>
      <TopBar />
      <div style={{position: 'absolute', left: 66, right: 66, top: 170, color: 'white'}}>
        <div style={{fontSize: 34, color: '#99f6e4', fontWeight: 900, marginBottom: 16}}>SAFE BY DESIGN</div>
        <div style={{fontSize: 72, fontWeight: 1000, lineHeight: 1.02}}>危険な操作は<br/>勝手に通さない</div>
      </div>
      <div style={{position: 'absolute', left: 72, right: 72, top: 610, borderRadius: 36, background: 'rgba(4,12,24,0.84)', border: '1px solid rgba(153,246,228,0.32)', padding: 32, boxShadow: '0 30px 90px rgba(0,0,0,0.45)'}}>
        <div style={{height: 54, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24}}>
          <div style={{width: 18, height: 18, borderRadius: 9, background: '#fb7185'}} />
          <div style={{width: 18, height: 18, borderRadius: 9, background: '#facc15'}} />
          <div style={{width: 18, height: 18, borderRadius: 9, background: '#4ade80'}} />
          <div style={{marginLeft: 14, color: '#cbd5e1', fontWeight: 900, fontSize: 22}}>LocalAnt Control Center</div>
        </div>
        {rows.map((row, i) => {
          const local = frame - i * 12;
          const op = ease(local, [0, 15], [0, 1]);
          const bar = ease(local, [4, 40], [8, 100]);
          return <div key={row} style={{marginBottom: 24, opacity: op}}>
            <div style={{display: 'flex', justifyContent: 'space-between', color: 'white', fontSize: 31, fontWeight: 900, marginBottom: 10}}><span>{row}</span><span style={{color: i === 0 ? '#facc15' : neon}}>{i === 0 ? 'CHECK' : 'OK'}</span></div>
            <div style={{height: 16, background: 'rgba(255,255,255,0.12)', borderRadius: 999, overflow: 'hidden'}}><div style={{height: '100%', width: bar + '%', background: i === 0 ? 'linear-gradient(90deg,#facc15,#39ff88)' : 'linear-gradient(90deg,#39ff88,#67e8f9)'}} /></div>
          </div>;
        })}
      </div>
      <CaptionOverlay scene={scene} />
    </AbsoluteFill>
  );
}

function WorkflowScene({ scene }) {
  const frame = useCurrentFrame();
  const steps = ['Script', 'Voice', 'Captions', 'Video', 'Publish'];
  return (
    <AbsoluteFill style={{fontFamily: jpFont}}>
      <TopBar />
      <div style={{position: 'absolute', left: 62, right: 62, top: 165, color: 'white'}}>
        <div style={{fontSize: 34, color: '#99f6e4', fontWeight: 900, marginBottom: 16}}>VIDEO WORKFLOW</div>
        <div style={{fontSize: 70, fontWeight: 1000, lineHeight: 1.02}}>動画生成まで<br/>一気通貫</div>
      </div>
      <div style={{position: 'absolute', left: 86, right: 86, top: 560}}>
        {steps.map((step, i) => {
          const local = frame - i * 10;
          const x = i % 2 === 0 ? 0 : 390;
          const y = Math.floor(i / 2) * 190;
          const op = ease(local, [0, 18], [0, 1]);
          const tx = ease(local, [0, 22], [i % 2 === 0 ? -80 : 80, 0]);
          return <div key={step} style={{position: 'absolute', left: x + tx, top: y, width: 360, height: 138, opacity: op, borderRadius: 34, background: 'rgba(255,255,255,0.96)', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, fontWeight: 1000, boxShadow: '0 24px 65px rgba(0,0,0,0.32)'}}>{step}</div>;
        })}
        {[0,1,2,3].map((_, i) => {
          const op = ease(frame - i * 10, [14, 36], [0, 1]);
          return <div key={i} style={{position: 'absolute', left: i % 2 === 0 ? 360 : 230, top: 64 + Math.floor((i + 1) / 2) * 190, width: 130, height: 6, borderRadius: 999, opacity: op, background: 'linear-gradient(90deg,' + neon + ',' + cyan + ')', transform: 'rotate(' + (i % 2 === 0 ? 16 : -16) + 'deg)', boxShadow: '0 0 24px rgba(57,255,136,0.55)'}} />;
        })}
      </div>
      <CaptionOverlay scene={scene} />
    </AbsoluteFill>
  );
}

function CtaScene({ scene }) {
  const frame = useCurrentFrame();
  const scale = spring({frame, fps: 30, config: {damping: 12, stiffness: 80, mass: 0.9}});
  const halo = 0.35 + Math.sin(frame / 18) * 0.12;
  return (
    <AbsoluteFill style={{fontFamily: jpFont, alignItems: 'center', justifyContent: 'center'}}>
      <TopBar />
      <div style={{width: 820, height: 820, borderRadius: 410, background: 'radial-gradient(circle, rgba(57,255,136,' + halo + '), rgba(103,232,249,0.16) 42%, transparent 70%)', position: 'absolute'}} />
      <div style={{position: 'relative', zIndex: 10, transform: 'scale(' + (0.86 + scale * 0.14) + ')', textAlign: 'center', color: 'white', padding: 60}}>
        <div style={{fontSize: 42, color: '#99f6e4', fontWeight: 1000, marginBottom: 26}}>FINAL MESSAGE</div>
        <div style={{fontSize: 82, lineHeight: 1.02, fontWeight: 1000, letterSpacing: -2}}>ChatGPTに<br/><span style={{color: neon}}>ローカルで働く手</span>を。</div>
        <div style={{marginTop: 44, fontSize: 36, color: '#d1fae5', fontWeight: 900, background: 'rgba(4,12,24,0.72)', border: '1px solid rgba(153,246,228,0.34)', padding: '22px 30px', borderRadius: 999}}>LocalAnt</div>
      </div>
      <CaptionOverlay scene={scene} />
    </AbsoluteFill>
  );
}

function ImportedImageScene({ scene }) {
  const frame = useCurrentFrame();
  const imgScale = 1.02 + Math.sin(frame / 50) * 0.018;
  const cardY = ease(frame, [0, 24], [74, 0]);
  const op = ease(frame, [0, 20], [0, 1]);
  return (
    <AbsoluteFill style={{fontFamily: jpFont}}>
      <TopBar />
      <div style={{position: 'absolute', left: 58, right: 58, top: 150, color: 'white', zIndex: 20, opacity: op, transform: 'translateY(' + cardY + 'px)'}}>
        <div style={{fontSize: 31, fontWeight: 900, color: '#99f6e4', letterSpacing: 3, marginBottom: 14}}>GENERATED IMAGE</div>
        <div style={{fontSize: 62, fontWeight: 1000, lineHeight: 1.04}}>{scene.title}</div>
      </div>
      <div style={{position: 'absolute', left: 58, right: 58, top: 420, height: 880, borderRadius: 42, overflow: 'hidden', border: '2px solid rgba(153,246,228,0.42)', boxShadow: '0 34px 100px rgba(0,0,0,0.48)', background: 'rgba(4,12,24,0.82)', opacity: op, transform: 'translateY(' + cardY + 'px)'}}>
        <img src={staticFile(scene.assetFile)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + imgScale + ')'}} />
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(5,8,22,0.04), rgba(5,8,22,0.55))'}} />
      </div>
      <CaptionOverlay scene={scene} />
    </AbsoluteFill>
  );
}

function SceneRouter({ scene, index }) {
  if (scene.assetFile) return <ImportedImageScene scene={scene} />;
  if (index === 0) return <HeroScene scene={scene} />;
  if (index === 1) return <FeaturesScene scene={scene} />;
  if (index === 2) return <SecurityScene scene={scene} />;
  if (index === 3) return <WorkflowScene scene={scene} />;
  return <CtaScene scene={scene} />;
}

function LocalAntVideoStudio(props) {
  return (
    <AbsoluteFill style={{fontFamily: jpFont, background: '#050816'}}>
      {props.narrationFile ? <Audio src={staticFile(props.narrationFile)} /> : null}
      <AnimatedBackground />
      {props.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
          <SceneRouter scene={scene} index={index} />
        </Sequence>
      ))}
      <ProgressBar />
    </AbsoluteFill>
  );
}

function Root() {
  return (
    <Composition
      id="LocalAntVideoStudio"
      component={LocalAntVideoStudio}
      durationInFrames={defaultProps.durationInFrames}
      fps={defaultProps.fps}
      width={defaultProps.width}
      height={defaultProps.height}
      defaultProps={defaultProps}
    />
  );
}

registerRoot(Root);
`;
}
async function reviewVideo(gw: Gateway, projectId: string) {
  const { project, dir } = loadProject(gw, projectId);
  const outputPath = path.join(dir, "output", "output.mp4");
  const thumbnailPath = path.join(dir, "output", "thumbnail.jpg");
  const captionsPath = path.join(dir, "captions", "output.srt");
  const assPath = path.join(dir, "captions", "output.ass");
  const renderPlanPath = path.join(dir, "render", "render-plan.json");
  const renderPropsPath = path.join(dir, "render", "render-props.json");
  const motionPlanPath = path.join(dir, "render", "motion-plan.json");
  const wordsPath = path.join(dir, "captions", "words.json");
  const base = { outputPath, thumbnailPath, captionsPath, assPath, wordsPath, storyboardPath: path.join(dir, "storyboard.json"), renderPlanPath, renderPropsPath, motionPlanPath };
  if (!fs.existsSync(outputPath)) return { ok: false, ...base, durationSeconds: 0, width: 0, height: 0, hasVideo: false, hasAudio: false, warnings: ["output.mp4 does not exist"] };
  if (!await hasCommand("ffprobe")) return { ok: true, ...base, durationSeconds: project.durationSeconds, ...dimensions(project.aspectRatio), hasVideo: true, hasAudio: fs.existsSync(path.join(dir, "audio", "narration.wav")), warnings: ["ffprobe not available"] };
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", outputPath]);
  const probe = JSON.parse(stdout);
  const video = (probe.streams ?? []).find((s: any) => s.codec_type === "video");
  const hasAudio = (probe.streams ?? []).some((s: any) => s.codec_type === "audio");
  const durationSeconds = Number(probe.format?.duration ?? 0);
  const warnings = [];
  const narration = path.join(dir, "audio", "narration.wav");
  const audioDurationSeconds = fs.existsSync(narration) ? await probeDuration(narration) : project.scenes.reduce((sum, scene) => sum + (scene.audioDurationSeconds ?? scene.durationSeconds), 0);
  if (Math.abs(durationSeconds - project.durationSeconds) > 3) warnings.push("duration differs from project duration");
  if (audioDurationSeconds > 0 && durationSeconds + 0.15 < audioDurationSeconds) warnings.push(`audio would be cut: video ${roundSeconds(durationSeconds)}s is shorter than narration ${audioDurationSeconds}s`);
  if (!hasAudio && audioDurationSeconds > 0) warnings.push("rendered video has no audio stream");
  const ok = Boolean(video) && hasAudio && !warnings.some((w) => /audio would be cut|no audio stream/i.test(w));
  return { ok, ...base, renderer: project.renderer ?? "unknown", durationSeconds, audioDurationSeconds, width: video?.width ?? 0, height: video?.height ?? 0, hasVideo: Boolean(video), hasAudio, warnings };
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

async function publishVideo(gw: Gateway, input: BrowserPublishInput) {
  const { dir } = loadProject(gw, input.projectId);
  const prepared = await publishPrepare(gw, input.projectId, [input.platform]);
  const outputPath = path.join(dir, "output", "output.mp4");
  if (input.dryRun) return { ok: true, dryRun: true, networkCalled: false, outputPath, prepared };
  if (input.provider === "browser") {
    const metadataPath = path.join(dir, "output", `metadata-${input.platform}.json`);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as { title?: string; description?: string };
    const browserPlan = buildBrowserPlan(gw, input, outputPath, metadataPath);
    if (!input.executeBrowser) {
      appendRun(dir, "publish.browser.planned", { platform: input.platform, browserPlan });
      return {
        ok: true,
        dryRun: false,
        provider: "browser",
        networkCalled: false,
        outputPath,
        stoppedBeforeSubmit: browserPlan.stoppedBeforeSubmit,
        browserPlan,
        uploadAttempted: false,
        readyToExecute: true,
      };
    }
    const result = await runBrowserUpload(browserPlan, metadata, input);
    appendRun(dir, "publish.browser.upload", { platform: input.platform, ...result });
    return {
      ...result,
      dryRun: false,
      provider: "browser",
      networkCalled: true,
      outputPath,
      stoppedBeforeSubmit: browserPlan.stoppedBeforeSubmit,
      browserPlan,
    };
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

function buildBrowserPlan(gw: Gateway, input: BrowserPublishInput, outputPath: string, metadataPath: string): BrowserPlan {
  const defaults = platformSelectors(input.platform);
  const submitSelector = input.submitSelector ?? defaults.submitSelector;
  return {
    uploadUrl: input.uploadUrl ?? setupUrl(input.platform),
    fileInputSelector: input.fileInputSelector ?? defaults.fileInputSelector,
    titleSelector: input.titleSelector ?? defaults.titleSelector,
    descriptionSelector: input.descriptionSelector ?? defaults.descriptionSelector,
    submitSelector,
    outputPath,
    metadataPath,
    profileDir: path.join(videoRoot(gw), "browser-profiles", input.platform),
    stoppedBeforeSubmit: !input.confirmBrowserPublish,
    actions: [
      "goto",
      "setInputFiles",
      "fillMetadata",
      input.confirmBrowserPublish && submitSelector ? "clickSubmit" : "stopBeforeSubmit",
    ],
  };
}

function platformSelectors(platform: Platform): { fileInputSelector: string; titleSelector: string | null; descriptionSelector: string | null; submitSelector: string | null } {
  if (platform === "youtube") {
    return {
      fileInputSelector: "input[type=file]",
      titleSelector: "input#textbox, textarea[aria-label*='Title'], [contenteditable='true']",
      descriptionSelector: "textarea#description, textarea[aria-label*='Description'], [contenteditable='true']",
      submitSelector: "ytcp-button#done-button, button[aria-label*='Publish'], button:has-text('Publish')",
    };
  }
  if (platform === "tiktok") {
    return {
      fileInputSelector: "input[type=file], input[accept*='video']",
      titleSelector: "[contenteditable='true'], textarea, input[name='title']",
      descriptionSelector: "textarea, [contenteditable='true']",
      submitSelector: "button[type='submit'], button:has-text('Post'), button:has-text('Publish')",
    };
  }
  return {
    fileInputSelector: "input[type=file], input[accept*='video']",
    titleSelector: "textarea, input[name='caption'], [contenteditable='true']",
    descriptionSelector: "textarea, input[name='caption'], [contenteditable='true']",
    submitSelector: "button[type='submit'], button:has-text('Share'), button:has-text('Post')",
  };
}

type PlaywrightLike = {
  chromium?: {
    launchPersistentContext?: (profileDir: string, options: unknown) => Promise<{
      newPage: () => Promise<any>;
      close: () => Promise<unknown>;
    }>;
  };
  default?: PlaywrightLike;
};

async function loadPlaywrightRuntime(): Promise<Required<Pick<PlaywrightLike, "chromium">>> {
  try {
    // @ts-ignore optional dependency resolved at runtime
    const mod = await import("playwright") as PlaywrightLike;
    const runtime = mod.chromium ? mod : mod.default;
    if (runtime?.chromium?.launchPersistentContext) return runtime as Required<Pick<PlaywrightLike, "chromium">>;
  } catch {
    /* fall through */
  }
  const entry = resolveOptionalDep("playwright");
  if (entry) {
    const mod = await import(pathToFileURL(entry).href) as PlaywrightLike;
    const runtime = mod.chromium ? mod : mod.default;
    if (runtime?.chromium?.launchPersistentContext) return runtime as Required<Pick<PlaywrightLike, "chromium">>;
  }
  throw new Error("Playwright is not installed. Run `localant deps install browser`.");
}

async function runBrowserUpload(plan: BrowserPlan, metadata: { title?: string; description?: string }, input: BrowserPublishInput) {
  let context: Awaited<ReturnType<NonNullable<NonNullable<PlaywrightLike["chromium"]>["launchPersistentContext"]>>> | undefined;
  try {
    const { chromium } = await loadPlaywrightRuntime();
    fs.mkdirSync(plan.profileDir, { recursive: true });
    context = await chromium.launchPersistentContext!(plan.profileDir, { headless: input.headless, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(plan.uploadUrl, { waitUntil: "domcontentloaded", timeout: input.timeoutMs });
    await page.waitForSelector(plan.fileInputSelector, { timeout: input.timeoutMs });
    await page.setInputFiles(plan.fileInputSelector, plan.outputPath);
    if (plan.titleSelector && metadata.title) await fillFirstAvailable(page, plan.titleSelector, metadata.title, input.timeoutMs);
    if (plan.descriptionSelector && metadata.description) await fillFirstAvailable(page, plan.descriptionSelector, metadata.description, input.timeoutMs);
    if (input.confirmBrowserPublish && plan.submitSelector) {
      await page.click(plan.submitSelector, { timeout: input.timeoutMs });
      return { ok: true, uploadAttempted: true, submitted: true, finalUrl: page.url() };
    }
    return { ok: true, uploadAttempted: true, submitted: false, finalUrl: page.url(), note: "Stopped before submit. Call again with confirmBrowserPublish=true to click the configured submit selector." };
  } catch (e) {
    return {
      ok: false,
      setupRequired: true,
      uploadAttempted: false,
      reason: (e as Error).message,
      note: "Log in manually in the opened persistent browser profile if required. LocalAnt does not bypass login, CAPTCHA, 2FA, or bot protection.",
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function fillFirstAvailable(page: any, selectorList: string, value: string, timeoutMs: number): Promise<void> {
  const selectors = selectorList.split(",").map((s) => s.trim()).filter(Boolean);
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: Math.min(timeoutMs, 5000) });
      await page.fill(selector, value, { timeout: Math.min(timeoutMs, 5000) });
      return;
    } catch {
      try {
        await page.locator(selector).first().click({ timeout: 1000 });
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.type(value);
        return;
      } catch {
        /* try next selector */
      }
    }
  }
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
