import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createGateway } from "@localant/gateway";
import { isToolInProfile } from "@localant/shared";

let base: string;
let oldVoicevoxEndpoint: string | undefined;

function gateway() {
  const gw = createGateway(base);
  gw.saveConfig({
    ...gw.config(),
    tools: { ...gw.config().tools, profile: "full", features: { ...gw.config().tools.features, videoStudio: true } },
    security: { ...gw.config().security, mode: "yolo" },
  });
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
  oldVoicevoxEndpoint = process.env.LOCALANT_VOICEVOX_ENDPOINT;
});

afterEach(() => {
  if (oldVoicevoxEndpoint === undefined) delete process.env.LOCALANT_VOICEVOX_ENDPOINT;
  else process.env.LOCALANT_VOICEVOX_ENDPOINT = oldVoicevoxEndpoint;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("Video Studio", () => {
  it("ships OSS research notes before implementation", () => {
    const file = path.join(process.cwd(), "docs", "video-studio", "oss-research.md");
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, "utf8");
    for (const required of ["Remotion", "MoviePy", "WhisperX", "FFmpeg", "Aegisub", "OpenShorts"]) {
      expect(text).toContain(required);
    }
    expect(text).toMatch(/free local/i);
    expect(text).toContain("## Implementation mapping");
    expect(text).toContain("No source code copied");
  });

  it("registers the requested tools with risk annotations and coding profile exposure", () => {
    const gw = gateway();
    const risks: Record<string, number> = {
      video_studio_status: 0,
      video_studio_configure: 2,
      video_studio_create_script: 2,
      video_studio_create_project: 2,
      video_studio_list_projects: 0,
      video_studio_add_asset: 3,
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
    expect(isToolInProfile("video_studio_add_asset", "coding")).toBe(true);
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
      executeBrowser: false,
    });
    expect(browser.stoppedBeforeSubmit).toBe(true);
    expect(browser.browserPlan.actions).toContain("setInputFiles");
    expect(browser.browserPlan.profileDir).toContain("video-studio");
    expect(browser.readyToExecute || browser.uploadAttempted || browser.setupRequired).toBe(true);
  }, 120_000);

  it("imports a ChatGPT-generated image file as a scene asset for Remotion", async () => {
    const gw = gateway();
    const project = await call(gw, "video_studio_create_project", {
      title: "画像素材テスト",
      description: "ChatGPT生成画像を動画素材に使う",
      script: "画像を使った紹介動画です。",
      language: "ja",
      durationSeconds: 3,
      targetPlatforms: ["youtube"],
      scenes: [{ id: "scene-001", title: "生成画像", narration: "画像を使った紹介動画です。", onScreenText: "生成画像を素材化", durationSeconds: 3 }],
    });
    const sourceImage = path.join(base, "chatgpt-generated.png");
    fs.writeFileSync(sourceImage, tinyPng());

    const imported = await call(gw, "video_studio_add_asset", {
      projectId: project.project.id,
      sceneId: "scene-001",
      path: sourceImage,
    });

    expect(imported.ok).toBe(true);
    expect(imported.sceneId).toBe("scene-001");
    expect(imported.assetPath).toContain(path.join("assets", "scene-001"));
    expect(fs.existsSync(imported.assetPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(project.projectDir, "manifest.json"), "utf8"));
    expect(manifest.scenes[0].assetPath).toBe(imported.assetPath);

    await call(gw, "video_studio_generate_audio", { projectId: project.project.id });
    await call(gw, "video_studio_generate_captions", { projectId: project.project.id });
    await call(gw, "video_studio_render_video", { projectId: project.project.id });
    const props = JSON.parse(fs.readFileSync(path.join(project.projectDir, "render", "render-props.json"), "utf8"));
    expect(props.scenes[0].assetFile).toBe("assets/scene-001.png");
    expect(props.scenes[0].assetSource).toBe("imported-image");
  }, 120_000);

  it("uses VOICEVOX as the primary Japanese TTS and derives scene durations from probed audio", async () => {
    const voicevox = await startVoicevoxFixture();
    process.env.LOCALANT_VOICEVOX_ENDPOINT = voicevox.url;
    try {
      const gw = gateway();
      const status = await call(gw, "video_studio_status");
      expect(status.audio.primary).toBe("voicevox");
      expect(status.audio.voicevox.available).toBe(true);
      expect(status.audio.voicevox.speakerCount).toBeGreaterThan(0);

      const project = await call(gw, "video_studio_create_project", {
        title: "LocalAnt紹介",
        description: "LocalAntの紹介",
        script: "LocalAntはローカルPCを安全に操作します。\n動画生成もローカルで行います。",
        language: "ja",
        durationSeconds: 6,
        targetPlatforms: ["youtube"],
        scenes: [
          { id: "scene-001", title: "LocalAnt", narration: "LocalAntはローカルPCを安全に操作します。", onScreenText: "ローカルPCを安全に操作" },
          { id: "scene-002", title: "Video Studio", narration: "動画生成もローカルで行います。", onScreenText: "動画生成もローカル" },
        ],
      });

      const audio = await call(gw, "video_studio_generate_audio", { projectId: project.project.id });
      expect(audio.engine).toBe("voicevox");
      expect(audio.scenes.map((s: { durationSeconds: number }) => s.durationSeconds)).toEqual([1.25, 1.75]);

      const manifest = JSON.parse(fs.readFileSync(path.join(project.projectDir, "manifest.json"), "utf8"));
      expect(manifest.durationSeconds).toBe(3);
      expect(manifest.scenes.map((s: { durationSeconds: number }) => s.durationSeconds)).toEqual([1.25, 1.75]);

      const captions = await call(gw, "video_studio_generate_captions", { projectId: project.project.id });
      expect(fs.existsSync(captions.srtPath)).toBe(true);
      expect(fs.existsSync(captions.assPath)).toBe(true);
      expect(fs.existsSync(captions.wordsPath)).toBe(true);
    } finally {
      await voicevox.close();
    }
  }, 120_000);

  it("writes Remotion render props and motion plan outputs", async () => {
    const gw = gateway();
    const script = await call(gw, "video_studio_create_script", { topic: "LocalAnt", language: "ja", durationSeconds: 6 });
    const project = await call(gw, "video_studio_create_project", {
      title: script.title,
      description: script.description,
      script: script.script,
      scenes: script.scenes,
      durationSeconds: 6,
      language: "ja",
    });
    await call(gw, "video_studio_generate_audio", { projectId: project.project.id });
    await call(gw, "video_studio_generate_captions", { projectId: project.project.id });
    const rendered = await call(gw, "video_studio_render_video", { projectId: project.project.id });

    expect(rendered.renderer).toBe("remotion");
    expect(fs.existsSync(path.join(project.projectDir, "render", "render-props.json"))).toBe(true);
    expect(fs.existsSync(path.join(project.projectDir, "render", "motion-plan.json"))).toBe(true);

    const props = JSON.parse(fs.readFileSync(path.join(project.projectDir, "render", "render-props.json"), "utf8"));
    const motion = JSON.parse(fs.readFileSync(path.join(project.projectDir, "render", "motion-plan.json"), "utf8"));
    expect(props.scenes.length).toBeGreaterThanOrEqual(1);
    expect(motion.animations).toEqual(expect.arrayContaining(["background", "card", "title", "captions", "progress", "cta"]));
  }, 120_000);

  it("fails review when the rendered video is shorter than narration audio", async () => {
    if (!hasCommandSync("ffmpeg") || !hasCommandSync("ffprobe")) return;
    const gw = gateway();
    const project = await call(gw, "video_studio_create_project", {
      title: "音切れ検証",
      description: "音声が切れる動画を検出する",
      script: "長い音声を短い動画に入れる",
      language: "ja",
      durationSeconds: 3,
      targetPlatforms: ["youtube"],
      scenes: [{ id: "scene-001", title: "検証", narration: "長い音声です。", onScreenText: "音切れ検証", durationSeconds: 3 }],
    });
    fs.writeFileSync(path.join(project.projectDir, "audio", "narration.wav"), wavBuffer(3));
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#101827:s=1080x1920:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=24000:cl=mono",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      path.join(project.projectDir, "output", "output.mp4"),
    ], { stdio: "ignore" });
    const review = await call(gw, "video_studio_review_video", { projectId: project.project.id });
    expect(review.ok).toBe(false);
    expect(review.warnings.join(" ")).toMatch(/audio|short|cut|途中|音声/i);
  }, 120_000);

  it("returns a concrete browser upload plan for operational publishing", async () => {
    const gw = gateway();
    const script = await call(gw, "video_studio_create_script", { topic: "Browser upload", durationSeconds: 6 });
    const project = await call(gw, "video_studio_create_project", {
      title: script.title,
      description: script.description,
      script: script.script,
      scenes: script.scenes,
      durationSeconds: 6,
    });
    await call(gw, "video_studio_generate_video", { projectId: project.project.id });

    const publish = await call(gw, "video_studio_publish_video", {
      projectId: project.project.id,
      platform: "youtube",
      provider: "browser",
      dryRun: false,
      confirmBrowserPublish: false,
      executeBrowser: false,
      uploadUrl: "https://studio.youtube.com/",
      fileInputSelector: "input[type=file]",
      titleSelector: "input[name=title]",
      descriptionSelector: "textarea[name=description]",
      submitSelector: "button[type=submit]",
    });

    expect(publish.browserPlan).toMatchObject({
      uploadUrl: "https://studio.youtube.com/",
      fileInputSelector: "input[type=file]",
      titleSelector: "input[name=title]",
      descriptionSelector: "textarea[name=description]",
      submitSelector: "button[type=submit]",
      stoppedBeforeSubmit: true,
    });
    expect(publish.browserPlan.actions).toEqual(["goto", "setInputFiles", "fillMetadata", "stopBeforeSubmit"]);
  }, 120_000);

  it("rejects path traversal in browser upload assist", async () => {
    const gw = gateway();
    const bad = await gw.executeTool("browser_upload_file", { selector: "input[type=file]", path: "../outside.mp4" }, { caller: "test" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/absolute|workspace|traversal|LocalAnt/i);
  });
});

function hasCommandSync(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function wavBuffer(durationSeconds: number): Buffer {
  const sampleRate = 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.round(sampleRate * durationSeconds);
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADggGOSHzRgQAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function startVoicevoxFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  let synthesisCount = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/speakers") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ name: "テスト話者", speaker_uuid: "fixture", styles: [{ id: 3, name: "ノーマル" }] }]));
      return;
    }
    if (req.method === "POST" && url.pathname === "/audio_query") {
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1, outputSamplingRate: 24000, outputStereo: false, kana: "" }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/synthesis") {
      req.resume();
      synthesisCount += 1;
      res.setHeader("content-type", "audio/wav");
      res.end(wavBuffer(synthesisCount === 1 ? 1.25 : 1.75));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("VOICEVOX fixture did not start.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}
