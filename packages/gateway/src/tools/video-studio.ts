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
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { title: string; durationSeconds?: number };
  const outName = safeOutputName(input.outputFilename);
  const output = path.join(dir, "output", outName);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const engine = input.engine || "builtin-ffmpeg";
  if (engine !== "builtin-ffmpeg") {
    const template = input.commandTemplate;
    if (!template) return { ok: false, setupRequired: true, engine, error: "commandTemplate is required for this engine." };
    return { ok: false, setupRequired: true, engine, error: "Custom engine execution is intentionally not enabled until commandTemplate execution is reviewed." };
  }
  const has = await gw.shell.runBash("command -v ffmpeg", { cwd: dir, timeoutMs: 10_000, maxOutputBytes: 2_000 });
  if (has.code !== 0) return { ok: false, setupRequired: true, engine, error: "ffmpeg is not installed or not on PATH." };
  const duration = Math.max(1, Math.min(3600, manifest.durationSeconds || 60));
  const title = String(manifest.title || "Video").replace(/[\\:'\[\]\n\r]/g, " ").slice(0, 120);
  const command = "ffmpeg -y -f lavfi -i " + q("color=c=0x111827:s=1080x1920:d=" + duration) + " -vf " + q("drawtext=text='" + title + "':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=220:box=1:boxcolor=black@0.35:boxborderw=24") + " -pix_fmt yuv420p " + q(output);
  const res = await gw.shell.runBash(command, { cwd: dir, timeoutMs: Math.max(120_000, duration * 3_000), maxOutputBytes: 30_000 });
  const result = { ok: res.code === 0 && fs.existsSync(output), engine, output, code: res.code, timedOut: res.timedOut, stderr: res.stderr.slice(-8_000) };
  fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify({ type: "generate", result, at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  return result;
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
