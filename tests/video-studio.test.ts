import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createGateway } from "@localant/gateway";
import { isToolInProfile } from "@localant/shared";

let base: string;

function gateway() {
  const gw = createGateway(base);
  gw.saveConfig({ ...gw.config(), tools: { profile: "full" }, security: { ...gw.config().security, mode: "yolo" } });
  return gw;
}

async function call(gw: ReturnType<typeof gateway>, name: string, input: Record<string, unknown> = {}) {
  const result = await gw.executeTool(name, input, { caller: "test" });
  if (!result.ok) throw new Error(result.error ?? JSON.stringify(result.approvalRequired));
  return result.data as any;
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "cla-video-"));
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("Video Studio", () => {
  it("ships OSS research notes before implementation", () => {
    const file = path.join(process.cwd(), "docs", "video-studio", "oss-research.md");
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    for (const required of ["Remotion", "MoviePy", "WhisperX", "FFmpeg", "Aegisub", "OpenShorts"]) {
      expect(text).toContain(required);
    }
    expect(text).toMatch(/free local/i);
  });

  it("registers the requested tools with risk annotations and coding profile exposure", () => {
    const gw = gateway();
    const risks: Record<string, number> = {
      video_studio_status: 0,
      video_studio_configure: 2,
      video_studio_create_script: 2,
      video_studio_create_project: 2,
      video_studio_list_projects: 0,
      video_studio_generate_assets: 3,
      video_studio_generate_audio: 3,
      video_studio_generate_captions: 3,
      video_studio_render_video: 3,
      video_studio_generate_video: 3,
      video_studio_review_video: 0,
      video_studio_publish_prepare: 2,
      video_studio_publish_video: 4,
      video_studio_open_setup: 3,
      video_studio_connect_account: 3,
      video_studio_test_publisher: 1,
      browser_upload_file: 3,
    };
    for (const [name, risk] of Object.entries(risks)) {
      expect(gw.registry.get(name)?.risk, name).toBe(risk);
    }
    expect(isToolInProfile("video_studio_generate_video", "coding")).toBe(true);
    expect(isToolInProfile("video_studio_publish_video", "coding")).toBe(false);
    expect(isToolInProfile("video_studio_status", "minimal")).toBe(true);
  });

  it("creates an upload-ready project without paid external video generation APIs", async () => {
    const gw = gateway();
    const status = await call(gw, "video_studio_status");
    expect(status.policy.videoGeneration).toMatch(/free local/i);
    expect(status.secrets.every((s: { present: boolean; value?: string }) => typeof s.value === "undefined")).toBe(true);

    const script = await call(gw, "video_studio_create_script", {
      topic: "LocalAntで動画制作を自動化する",
      language: "ja",
      durationSeconds: 12,
      targetPlatform: "youtube",
    });
    expect(script.script).toContain("LocalAnt");
    expect(script.scenes.length).toBeGreaterThanOrEqual(2);

    const project = await call(gw, "video_studio_create_project", {
      title: script.title,
      description: script.description,
      script: script.script,
      scenes: script.scenes,
      durationSeconds: 12,
      language: "ja",
      targetPlatforms: ["youtube", "tiktok", "instagram"],
    });
    for (const rel of ["manifest.json", "script.md", "storyboard.json", "assets", "audio", "captions", "output", "render", "runs.jsonl"]) {
      expect(fs.existsSync(path.join(project.projectDir, rel)), rel).toBe(true);
    }

    const assets = await call(gw, "video_studio_generate_assets", { projectId: project.project.id });
    expect(assets.assets.length).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(project.projectDir, "assets", "scene-001.png"))).toBe(true);

    const audio = await call(gw, "video_studio_generate_audio", { projectId: project.project.id });
    expect(audio.ok || audio.setupRequired).toBe(true);

    const captions = await call(gw, "video_studio_generate_captions", { projectId: project.project.id });
    expect(fs.existsSync(captions.srtPath)).toBe(true);
    expect(fs.existsSync(captions.assPath)).toBe(true);
    expect(fs.existsSync(captions.wordsPath)).toBe(true);

    const rendered = await call(gw, "video_studio_render_video", { projectId: project.project.id });
    if (rendered.setupRequired) {
      expect(rendered.reason).toMatch(/ffmpeg/i);
    } else {
      expect(fs.existsSync(rendered.outputPath)).toBe(true);
      expect(fs.existsSync(rendered.thumbnailPath)).toBe(true);
      expect(fs.existsSync(rendered.renderPlanPath)).toBe(true);
    }

    const review = await call(gw, "video_studio_review_video", { projectId: project.project.id });
    if (!rendered.setupRequired) {
      expect(review.ok).toBe(true);
      expect(review.hasVideo).toBe(true);
      expect(review.width).toBe(1080);
      expect(review.height).toBe(1920);
    }

    const prepared = await call(gw, "video_studio_publish_prepare", { projectId: project.project.id, platforms: ["youtube", "tiktok", "instagram"] });
    expect(fs.existsSync(path.join(project.projectDir, "output", "metadata-youtube.json"))).toBe(true);
    expect(prepared.metadata.youtube.title).toBeTruthy();

    const dry = await call(gw, "video_studio_publish_video", { projectId: project.project.id, platform: "youtube", dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.networkCalled).toBe(false);

    const browser = await call(gw, "video_studio_publish_video", {
      projectId: project.project.id,
      platform: "youtube",
      provider: "browser",
      dryRun: false,
      confirmBrowserPublish: false,
    });
    expect(browser.stoppedBeforeSubmit).toBe(true);
  }, 20_000);

  it("rejects path traversal in browser upload assist", async () => {
    const gw = gateway();
    const bad = await gw.executeTool("browser_upload_file", { selector: "input[type=file]", path: "../outside.mp4" }, { caller: "test" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/absolute|workspace|traversal|LocalAnt/i);
  });
});
