import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { z } from "zod";
import type { Gateway } from "../gateway.js";

const platformSchema = z.enum(["youtube", "tiktok", "instagram"]);
const providerSchema = z.enum(["youtube-official", "tiktok-direct-post", "tiktok-inbox-upload", "instagram-graph", "upload-post", "browser", "custom-command"]);
const engineSchema = z.enum(["builtin-ffmpeg", "short-video-maker", "openshorts", "custom"]);
const privacySchema = z.enum(["private", "public", "unlisted", "SELF_ONLY", "PUBLIC_TO_EVERYONE"]);
const metaInput = z.object({
  projectId: z.string().optional(),
  videoPath: z.string().optional(),
  platform: platformSchema,
  provider: providerSchema.optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  privacyStatus: privacySchema.optional(),
  scheduledAt: z.string().optional(),
  publicVideoUrl: z.string().url().optional(),
  metadataPath: z.string().optional(),
});

export function registerVideoStudioTools(gw: Gateway): void {
  const r = gw.registry;
  r.register({ name: "video_studio_status", description: "Return Video Studio status without secret values.", risk: 0, inputSchema: z.object({}).strip(), handler: () => status(gw) });
  r.register({ name: "video_studio_configure", description: "Configure Video Studio settings. Secret values are not accepted.", risk: 2, inputSchema: z.object({ workspaceDir: z.string().optional(), generator: z.object({ engine: engineSchema.optional(), commandTemplate: z.string().optional() }).optional(), publishers: z.record(z.string(), z.unknown()).optional() }).strip(), summarize: () => "configure Video Studio", auditInput: (i) => ({ ...i, secretValues: "not accepted" }), handler: () => ({ ok: true }) });
  r.register({ name: "video_studio_create_project", description: "Create a Video Studio project.", risk: 2, inputSchema: z.object({ title: z.string().min(1), description: z.string().default(""), script: z.string().min(1), language: z.string().default("ja"), durationSeconds: z.number().int().min(1).max(3600).default(60), aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"), targetPlatforms: z.array(platformSchema).default(["youtube", "tiktok", "instagram"]), hashtags: z.array(z.string()).default([]), scenes: z.array(z.unknown()).default([]) }).strip(), summarize: (i) => `create Video Studio project: ${i.title}`, handler: (i) => createProject(gw, i) });
  r.register({ name: "video_studio_list_projects", description: "List Video Studio projects.", risk: 0, inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(100) }).strip(), handler: (i) => list(gw, i.limit) });
  r.register({ name: "video_studio_generate_video", description: "Generate a project video with the configured engine.", risk: 3, inputSchema: z.object({ projectId: z.string().min(1), engine: engineSchema.optional(), commandTemplate: z.string().optional(), outputFilename: z.string().default("output.mp4") }).strip(), summarize: (i) => `generate video for ${i.projectId}`, handler: (i) => generateVideo(gw, i) });
  r.register({ name: "video_studio_publish_prepare", description: "Prepare platform metadata without network action.", risk: 2, inputSchema: metaInput.strip(), summarize: (i) => `prepare ${i.platform} metadata`, handler: (i) => prepareMetadata(gw, i) });
  r.register({ name: "video_studio_publish_video", description: "Run a platform delivery action. Actual network action requires dryRun=false. Risk 4.", risk: 4, inputSchema: metaInput.extend({ dryRun: z.boolean().default(true), confirmBrowserPublish: z.boolean().default(false) }).strip(), summarize: (i) => `${i.dryRun === false ? "run" : "dry-run"} ${i.platform} delivery`, auditInput: (i) => ({ ...i, secretValues: "not accepted" }), handler: async (i) => i.dryRun === false ? runDelivery(gw, i) : prepareMetadata(gw, i) });
  r.register({ name: "video_studio_open_setup", description: "Return setup link for Video Studio.", risk: 3, inputSchema: z.object({ platform: z.enum(["youtube", "tiktok", "instagram", "generator", "upload-post"]) }).strip(), summarize: (i) => `open setup for ${i.platform}`, handler: (i) => ({ platform: i.platform }) });
  r.register({ name: "video_studio_connect_account", description: "Start account setup for Video Studio.", risk: 3, inputSchema: z.object({ platform: platformSchema, provider: providerSchema.optional() }).strip(), summarize: (i) => `connect account for ${i.platform}`, handler: (i) => ({ platform: i.platform, provider: i.provider }) });
  r.register({ name: "video_studio_test_publisher", description: "Check provider readiness without delivery.", risk: 1, inputSchema: z.object({ platform: platformSchema, provider: providerSchema.optional() }).strip(), handler: (i) => ({ platform: i.platform, provider: i.provider, ready: false }) });
}

type ProjectInput = { title: string; description: string; script: string; language: string; durationSeconds: number; aspectRatio: "9:16" | "16:9" | "1:1"; targetPlatforms: string[]; hashtags: string[]; scenes: unknown[] };

function createProject(gw: Gateway, input: ProjectInput) {
  const root = path.join(gw.paths.workspaceDir, "video-studio", "projects");
  const id = safeName(slug(input.title) + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex"));
  const dir = path.join(root, id);
  gw.pathGuard.assertAccess(dir, "write");
  fs.mkdirSync(path.join(dir, "output"), { recursive: true });
  fs.mkdirSync(path.join(dir, "metadata"), { recursive: true });
  const now = new Date().toISOString();
  const manifest = { id, ...input, createdAt: now, updatedAt: now };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "script.md"), ["# " + input.title, "", input.description, "", "## Script", "", input.script, ""].join("\n"), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "runs.jsonl"), "", { mode: 0o600 });
  return { id, projectDir: dir, manifestPath: path.join(dir, "manifest.json"), scriptPath: path.join(dir, "script.md") };
}


async function generateVideo(gw: Gateway, input: { projectId: string; engine?: string; commandTemplate?: string; outputFilename: string }) {
  const projectRoot = path.join(workspaceRoot(gw), "projects");
  const dir = path.join(projectRoot, safeName(input.projectId));
  gw.pathGuard.assertAccess(dir, "write");
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Project manifest not found: " + input.projectId);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, any>;
  const outName = safeOutputName(input.outputFilename);
  const output = path.join(dir, "output", outName);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const engine = input.engine || "builtin-ffmpeg";

  if (engine !== "builtin-ffmpeg") {
    return runExternalVideoEngine(gw, dir, manifest, engine, input.commandTemplate, output);
  }

  const has = await gw.shell.runBash("command -v ffmpeg", { cwd: dir, timeoutMs: 10_000, maxOutputBytes: 2_000 });
  if (has.code !== 0) return { ok: false, setupRequired: true, engine, error: "ffmpeg is not installed or not on PATH." };

  const renderId = "render-" + Date.now().toString(36);
  const renderDir = path.join(dir, "render", renderId);
  fs.mkdirSync(renderDir, { recursive: true });
  const dimensions = dimensionsForAspect(String(manifest.aspectRatio ?? "9:16"));
  const scenes = buildScenePlan(renderDir, manifest, dimensions);
  const renderPlanPath = path.join(renderDir, "render-plan.json");
  const captionsPath = path.join(dir, "output", outName.replace(/\.mp4$/i, ".srt"));
  const storyboardPath = path.join(dir, "output", outName.replace(/\.mp4$/i, ".storyboard.json"));
  const thumbnailPath = path.join(dir, "output", outName.replace(/\.mp4$/i, ".jpg"));
  fs.writeFileSync(renderPlanPath, JSON.stringify({ engine, dimensions, scenes }, null, 2), { mode: 0o600 });
  fs.writeFileSync(captionsPath, toSrt(scenes), { mode: 0o600 });
  fs.writeFileSync(storyboardPath, JSON.stringify(scenes.map(({ textPath, titlePath, segmentPath, ...scene }) => scene), null, 2), { mode: 0o600 });

  for (const scene of scenes) {
    fs.writeFileSync(scene.titlePath, scene.title, { mode: 0o600 });
    fs.writeFileSync(scene.textPath, scene.body, { mode: 0o600 });
    const filter = sceneFilter(scene, dimensions);
    const cmd =
      "ffmpeg -y -f lavfi -i " +
      q(`color=c=${scene.color}:s=${dimensions.width}x${dimensions.height}:d=${scene.duration}`) +
      " -vf " +
      q(filter) +
      " -an -r 30 -pix_fmt yuv420p " +
      q(scene.segmentPath);
    const res = await gw.shell.runBash(cmd, { cwd: dir, timeoutMs: Math.max(120_000, scene.duration * 20_000), maxOutputBytes: 30_000 });
    if (res.code !== 0 || !fs.existsSync(scene.segmentPath)) {
      const result = { ok: false, engine, stage: "segment", scene: scene.index, code: res.code, stderr: res.stderr.slice(-8_000), renderPlanPath };
      fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify({ type: "generate", result, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
      return result;
    }
  }

  const concatPath = path.join(renderDir, "concat.txt");
  fs.writeFileSync(concatPath, scenes.map((s) => "file " + JSON.stringify(s.segmentPath) + "\n").join(""), { mode: 0o600 });
  const concat = await gw.shell.runBash("ffmpeg -y -f concat -safe 0 -i " + q(concatPath) + " -c copy " + q(output), {
    cwd: dir,
    timeoutMs: Math.max(120_000, scenes.reduce((sum, s) => sum + s.duration, 0) * 10_000),
    maxOutputBytes: 30_000,
  });
  if (concat.code === 0 && fs.existsSync(output)) {
    await gw.shell.runBash("ffmpeg -y -ss 00:00:01 -i " + q(output) + " -frames:v 1 " + q(thumbnailPath), {
      cwd: dir,
      timeoutMs: 60_000,
      maxOutputBytes: 10_000,
    });
  }
  const result = {
    ok: concat.code === 0 && fs.existsSync(output),
    engine,
    output,
    thumbnailPath: fs.existsSync(thumbnailPath) ? thumbnailPath : undefined,
    captionsPath,
    storyboardPath,
    renderPlanPath,
    sceneCount: scenes.length,
    durationSeconds: scenes.reduce((sum, s) => sum + s.duration, 0),
    aspectRatio: manifest.aspectRatio ?? "9:16",
    code: concat.code,
    timedOut: concat.timedOut,
    stderr: concat.stderr.slice(-8_000),
  };
  fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify({ type: "generate", result, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  return result;
}


type VideoDimensions = { width: number; height: number };
type PlannedScene = {
  index: number;
  title: string;
  body: string;
  narration: string;
  color: string;
  duration: number;
  start: number;
  end: number;
  titlePath: string;
  textPath: string;
  segmentPath: string;
};

async function runExternalVideoEngine(
  gw: Gateway,
  dir: string,
  manifest: Record<string, any>,
  engine: string,
  commandTemplate: string | undefined,
  output: string,
) {
  if (!commandTemplate) {
    return {
      ok: false,
      setupRequired: true,
      engine,
      error: `${engine} requires commandTemplate. Use placeholders: {{projectDir}}, {{manifestPath}}, {{outputPath}}.`,
    };
  }
  const manifestPath = path.join(dir, "manifest.json");
  const command = commandTemplate
    .replaceAll("{{projectDir}}", q(dir))
    .replaceAll("{{manifestPath}}", q(manifestPath))
    .replaceAll("{{outputPath}}", q(output))
    .replaceAll("{{title}}", q(String(manifest.title ?? "")))
    .replaceAll("{{script}}", q(String(manifest.script ?? "")));
  const res = await gw.shell.runBash(command, { cwd: dir, timeoutMs: 30 * 60_000, maxOutputBytes: 80_000 });
  const result = { ok: res.code === 0 && fs.existsSync(output), engine, output, code: res.code, timedOut: res.timedOut, stderr: res.stderr.slice(-12_000) };
  fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify({ type: "generate", result, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  return result;
}

function dimensionsForAspect(aspectRatio: string): VideoDimensions {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function buildScenePlan(renderDir: string, manifest: Record<string, any>, dimensions: VideoDimensions): PlannedScene[] {
  const totalDuration = Math.max(3, Math.min(3600, Number(manifest.durationSeconds ?? 45)));
  const rawScenes = normalizeRawScenes(manifest);
  const baseDuration = Math.max(2, Math.floor(totalDuration / Math.max(1, rawScenes.length)));
  let cursor = 0;
  return rawScenes.map((scene, index) => {
    const remaining = Math.max(2, totalDuration - cursor);
    const duration = index === rawScenes.length - 1 ? remaining : Math.max(2, Math.min(remaining, Number(scene.durationSeconds ?? baseDuration)));
    const title = wrapText(String(scene.title || (index === 0 ? manifest.title : `Scene ${index + 1}`)), dimensions.width >= dimensions.height ? 24 : 14).slice(0, 240);
    const body = wrapText(String(scene.body || scene.text || scene.narration || ""), dimensions.width >= dimensions.height ? 42 : 22).slice(0, 900);
    const planned: PlannedScene = {
      index: index + 1,
      title,
      body,
      narration: String(scene.narration || scene.body || scene.text || ""),
      color: sceneColor(index),
      duration,
      start: cursor,
      end: cursor + duration,
      titlePath: path.join(renderDir, `scene-${index + 1}-title.txt`),
      textPath: path.join(renderDir, `scene-${index + 1}-body.txt`),
      segmentPath: path.join(renderDir, `scene-${index + 1}.mp4`),
    };
    cursor += duration;
    return planned;
  });
}

function normalizeRawScenes(manifest: Record<string, any>): Array<Record<string, any>> {
  if (Array.isArray(manifest.scenes) && manifest.scenes.length) {
    return manifest.scenes.map((scene: unknown, index: number) => {
      if (typeof scene === "string") return { title: index === 0 ? manifest.title : `Scene ${index + 1}`, body: scene };
      if (scene && typeof scene === "object") return scene as Record<string, any>;
      return { title: `Scene ${index + 1}`, body: String(scene ?? "") };
    });
  }
  const script = String(manifest.script || manifest.description || manifest.title || "LocalAnt Video Studio");
  const chunks = splitScript(script);
  return chunks.map((body, index) => ({ title: index === 0 ? manifest.title : `Point ${index + 1}`, body }));
}

function splitScript(script: string): string[] {
  const normalized = script.replace(/\r/g, "\n").split(/\n{2,}|(?<=[。.!?！？])\s+/).map((s) => s.trim()).filter(Boolean);
  if (normalized.length >= 2) return normalized.slice(0, 12);
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 18) return [script.trim() || "Generated with LocalAnt Video Studio"];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 18) chunks.push(words.slice(i, i + 18).join(" "));
  return chunks.slice(0, 12);
}

function wrapText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const lines: string[] = [];
  let line = "";
  for (const token of compact.split(" ")) {
    if (!line) line = token;
    else if ((line + " " + token).length <= maxChars) line += " " + token;
    else {
      lines.push(line);
      line = token;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function sceneColor(index: number): string {
  const palette = ["0x111827", "0x172554", "0x312e81", "0x4c1d95", "0x701a75", "0x7f1d1d", "0x064e3b", "0x134e4a"];
  return palette[index % palette.length]!;
}

function sceneFilter(scene: PlannedScene, dimensions: VideoDimensions): string {
  const font = detectFontFile();
  const fontArg = font ? `fontfile='${filterPath(font)}':` : "";
  const titleSize = Math.round(dimensions.height * 0.045);
  const bodySize = Math.round(dimensions.height * 0.027);
  const marginX = Math.round(dimensions.width * 0.075);
  const titleY = Math.round(dimensions.height * 0.13);
  const bodyY = Math.round(dimensions.height * 0.33);
  const progressWidth = Math.round(dimensions.width * 0.78 * (scene.index / Math.max(1, scene.index + 1)));
  return [
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.10:t=fill",
    `drawbox=x=${marginX}:y=${Math.round(dimensions.height * 0.08)}:w=${dimensions.width - marginX * 2}:h=${Math.round(dimensions.height * 0.18)}:color=black@0.28:t=fill`,
    `drawtext=${fontArg}textfile='${filterPath(scene.titlePath)}':fontcolor=white:fontsize=${titleSize}:line_spacing=12:x=${marginX + 32}:y=${titleY}`,
    `drawtext=${fontArg}textfile='${filterPath(scene.textPath)}':fontcolor=white:fontsize=${bodySize}:line_spacing=18:x=${marginX}:y=${bodyY}:box=1:boxcolor=black@0.32:boxborderw=28`,
    `drawbox=x=${marginX}:y=${dimensions.height - 150}:w=${dimensions.width - marginX * 2}:h=10:color=white@0.25:t=fill`,
    `drawbox=x=${marginX}:y=${dimensions.height - 150}:w=${progressWidth}:h=10:color=white@0.85:t=fill`,
    `drawtext=${fontArg}text='LocalAnt Video Studio':fontcolor=white@0.72:fontsize=${Math.round(dimensions.height * 0.018)}:x=${marginX}:y=${dimensions.height - 110}`,
  ].join(",");
}

function detectFontFile(): string | undefined {
  const candidates = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function filterPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function toSrt(scenes: PlannedScene[]): string {
  return scenes.map((scene, index) => [
    String(index + 1),
    `${srtTime(scene.start)} --> ${srtTime(scene.end)}`,
    scene.narration || scene.body.replace(/\n/g, " "),
    "",
  ].join("\n")).join("\n");
}

function srtTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},000`;
}


function workspaceRoot(gw: Gateway): string {
  const dir = path.join(gw.paths.workspaceDir, "video-studio");
  gw.pathGuard.assertAccess(dir, "write");
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
  fs.mkdirSync(path.join(dir, "metadata"), { recursive: true });
  return dir;
}

function status(gw: Gateway) {
  return { ok: true, workspaceDir: workspaceRoot(gw), supportedPlatforms: ["youtube", "tiktok", "instagram"], supportedProviders: providerSchema.options, supportedEngines: engineSchema.options, projectsCount: list(gw, 500).projects.length, recentProjects: list(gw, 10).projects, setupLinks: { youtube: "https://developers.google.com/youtube/v3/guides/uploading_a_video", tiktok: "https://developers.tiktok.com/doc/content-posting-api-get-started", instagram: "https://developers.facebook.com/docs/instagram-platform/content-publishing", generator: "https://github.com/gyoridavid/short-video-maker", uploadPost: "https://upload-post.com/" } };
}

function list(gw: Gateway, limit: number) {
  const root = path.join(workspaceRoot(gw), "projects");
  const projects = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const dir = path.join(root, d.name);
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : undefined;
    const outputDir = path.join(dir, "output");
    const metadataDir = path.join(dir, "metadata");
    const outputs = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter((f) => f.endsWith(".mp4")).map((f) => path.join(outputDir, f)) : [];
    const metadata = fs.existsSync(metadataDir) ? fs.readdirSync(metadataDir).filter((f) => f.endsWith(".json")).map((f) => path.join(metadataDir, f)) : [];
    return { id: d.name, dir, manifest, outputs, metadata };
  }).slice(0, limit) : [];
  return { workspaceDir: workspaceRoot(gw), projects };
}

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52) || "video";
}

function safeName(value: string): string {
  if (!/^[a-zA-Z0-9._-]{1,140}$/.test(value) || value.includes("..")) throw new Error("Invalid project id.");
  return value;
}

function safeOutputName(value: string): string {
  const base = path.basename(value);
  if (base !== value || base.includes("..")) throw new Error("Invalid output filename.");
  return base.toLowerCase().endsWith(".mp4") ? base : base + ".mp4";
}

function q(value: string): string {
  return JSON.stringify(value);
}

function prepareMetadata(gw: Gateway, input: z.output<typeof metaInput>) {
  const base = input.projectId ? path.join(workspaceRoot(gw), "projects", safeName(input.projectId)) : workspaceRoot(gw);
  const manifestPath = path.join(base, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, any> : {};
  const videoPath = input.videoPath ? resolveVideoPath(gw, base, input.videoPath) : findLatestVideo(base);
  const provider = input.provider ?? defaultProvider(input.platform);
  const metadata = {
    projectId: input.projectId,
    platform: input.platform,
    provider,
    videoPath,
    title: input.title ?? manifest.title ?? "Untitled video",
    description: input.description ?? manifest.description ?? "",
    tags: input.tags ?? manifest.hashtags ?? [],
    privacyStatus: input.privacyStatus ?? defaultPrivacy(input.platform),
    scheduledAt: input.scheduledAt,
    publicVideoUrl: input.publicVideoUrl,
    createdAt: new Date().toISOString(),
  };
  const metaDir = path.join(base, "metadata");
  fs.mkdirSync(metaDir, { recursive: true });
  const metadataPath = input.metadataPath ? path.join(metaDir, path.basename(input.metadataPath)) : path.join(metaDir, input.platform + "-" + Date.now() + ".json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  return { ok: true, dryRun: true, metadataPath, metadata, readiness: testReadiness(gw, input.platform, provider) };
}


function defaultProvider(platform: z.output<typeof platformSchema>): z.output<typeof providerSchema> {
  if (platform === "youtube") return "youtube-official";
  if (platform === "tiktok") return "tiktok-direct-post";
  return "upload-post";
}

function defaultPrivacy(platform: z.output<typeof platformSchema>): z.output<typeof privacySchema> {
  if (platform === "youtube") return "private";
  if (platform === "tiktok") return "SELF_ONLY";
  return "public";
}

function providerRequiredSecrets(platform: z.output<typeof platformSchema>, provider: z.output<typeof providerSchema>): string[] {
  void platform;
  if (provider === "youtube-official") return ["YOUTUBE_ACCESS_TOKEN"];
  if (provider === "tiktok-direct-post" || provider === "tiktok-inbox-upload") return ["TIKTOK_ACCESS_TOKEN"];
  if (provider === "instagram-graph") return ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID"];
  if (provider === "upload-post") return ["UPLOAD_POST_API_KEY"];
  return [];
}

function testReadiness(gw: Gateway, platform: z.output<typeof platformSchema>, provider: z.output<typeof providerSchema>) {
  const required = providerRequiredSecrets(platform, provider);
  const secrets = required.map((name) => ({ name, present: gw.vault.get(name) !== undefined }));
  return { platform, provider, ready: secrets.every((s) => s.present) || provider === "browser" || provider === "custom-command", requiredSecrets: secrets, setupRequired: secrets.some((s) => !s.present) && provider !== "browser" && provider !== "custom-command" };
}

function resolveVideoPath(gw: Gateway, base: string, value: string): string {
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value);
  const workspace = path.resolve(workspaceRoot(gw));
  if (!resolved.startsWith(workspace)) {
    throw new Error("videoPath escapes Video Studio workspace.");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("videoPath does not exist: " + resolved);
  }
  return resolved;
}

function findLatestVideo(base: string): string {
  const dir = path.join(base, "output");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".mp4")).sort() : [];
  if (!files.length) {
    throw new Error("No generated mp4 found. Run video_studio_generate_video first or pass videoPath.");
  }
  return path.join(dir, files[files.length - 1]!);
}


async function runDelivery(gw: Gateway, input: z.output<typeof metaInput> & { dryRun: boolean }) {
  return prepareMetadata(gw, input);
}

function requireSecret(gw: Gateway, name: string): string {
  const value = gw.vault.get(name);
  if (!value) throw new Error("Missing required secret: " + name);
  return value;
}


async function deliverUploadPost(gw: Gateway, metadata: Record<string, any>) {
  const apiKey = requireSecret(gw, "UPLOAD_POST_API_KEY");
  const endpoint = process.env.LOCALANT_UPLOAD_POST_ENDPOINT || "https://api.upload-post.com/api/upload";
  const form = multipartForm({
    platform: String(metadata.platform),
    title: String(metadata.title),
    description: String(metadata.description ?? ""),
    tags: Array.isArray(metadata.tags) ? metadata.tags.join(",") : "",
    privacyStatus: String(metadata.privacyStatus ?? ""),
    scheduledAt: String(metadata.scheduledAt ?? ""),
  }, String(metadata.videoPath));
  const response = await fetchJson(endpoint, {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "x-api-key": apiKey, "content-type": form.contentType, "content-length": String(form.body.length) },
    body: form.body as any,
  });
  return { ok: response.ok, provider: "upload-post", status: response.status, response: response.json ?? response.text, postUrl: response.json?.url ?? response.json?.postUrl, publishId: response.json?.id ?? response.json?.postId };
}

function multipartForm(fields: Record<string, string>, filePath: string) {
  const boundary = "localant-" + crypto.randomBytes(12).toString("hex");
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safeHeader(key)}"\r\n\r\n${value}\r\n`));
  }
  const file = fs.readFileSync(filePath);
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${safeHeader(path.basename(filePath))}"\r\nContent-Type: video/mp4\r\n\r\n`));
  chunks.push(file);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { contentType: "multipart/form-data; boundary=" + boundary, body: Buffer.concat(chunks) };
}

function safeHeader(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}

async function fetchJson(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : undefined }; }
  catch { return { ok: res.ok, status: res.status, text: text.slice(0, 20000) }; }
}
