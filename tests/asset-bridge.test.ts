import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createGateway,
  detectImageMime,
  looksLikeSvg,
  svgHasActiveContent,
  assertSafeUrl,
  isPrivateAddress,
  SsrfError,
} from "@localant/gateway";
import type { Gateway } from "@localant/gateway";

let base: string;
let workdir: string;
let gw: Gateway;

// A minimal valid 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function ctx() {
  return { caller: "test" };
}

/** Convenience: call the single asset tool. */
function save(source: unknown, destination: string, overwrite = false) {
  return gw.executeTool("asset_save_image", { source, destination, overwrite }, ctx());
}

function uploadChunk(input: Record<string, unknown>) {
  return gw.executeTool("asset_upload_chunk", input, ctx());
}

function commitUpload(input: Record<string, unknown>) {
  return gw.executeTool("asset_commit_upload", input, ctx());
}

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), ".tmp-tests"), { recursive: true });
  base = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-home-"));
  workdir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-work-"));
  gw = createGateway(base);
  // Default mode is "open": no allowlist restriction, only the sensitive
  // blocklist. The temp workdir is safely writable. Asset tools live in the
  // coding/full profiles, so switch off the minimal default.
  gw.saveConfig({
    ...gw.config(),
    tools: { ...gw.config().tools, profile: "coding", features: { ...gw.config().tools.features, assetBridge: true } },
  });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("image-bytes detection", () => {
  it("detects PNG / JPEG / GIF / WebP / SVG by magic bytes", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    expect(detectImageMime(webp)).toBe("image/webp");
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
  });

  it("rejects non-image content", () => {
    expect(detectImageMime(Buffer.from("hello world"))).toBeNull();
    expect(detectImageMime(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });

  it("flags active content in SVG", () => {
    expect(svgHasActiveContent(Buffer.from("<svg><script>alert(1)</script></svg>"))).toBe(true);
    expect(svgHasActiveContent(Buffer.from('<svg onload="x()"></svg>'))).toBe(true);
    expect(svgHasActiveContent(Buffer.from('<svg><rect width="1" height="1"/></svg>'))).toBe(false);
    expect(looksLikeSvg(Buffer.from("not svg"))).toBe(false);
  });
});

describe("ssrf guard", () => {
  it("classifies private addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("192.168.0.5")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("rejects non-http and private-literal URLs", () => {
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://127.0.0.1/x.png")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://localhost/x.png")).toThrow(SsrfError);
    expect(assertSafeUrl("https://example.com/x.png").hostname).toBe("example.com");
  });
});

describe("asset_save_image — base64 source", () => {
  it("validates and writes an inline base64 image", async () => {
    const dest = path.join(workdir, "out.png");
    const sha = crypto.createHash("sha256").update(PNG).digest("hex");
    const res = await save({ kind: "base64", data: PNG.toString("base64"), sha256: sha }, dest);
    expect(res.ok).toBe(true);
    const data = res.data as { path: string; mimeType: string; sha256: string; source: string };
    expect(data.mimeType).toBe("image/png");
    expect(data.sha256).toBe(sha);
    expect(data.source).toBe("base64");
    expect(fs.readFileSync(dest)).toEqual(PNG);
  });

  it("rejects a checksum mismatch", async () => {
    const dest = path.join(workdir, "bad.png");
    const res = await save({ kind: "base64", data: PNG.toString("base64"), sha256: "deadbeef" }, dest);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/checksum mismatch/i);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("rejects non-image content even when bytes decode cleanly", async () => {
    const dest = path.join(workdir, "evil.png");
    const payload = Buffer.from("#!/bin/sh\nrm -rf /\n");
    const res = await save({ kind: "base64", data: payload.toString("base64") }, dest);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unsupported|unrecognized/i);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("rejects an SVG with active content", async () => {
    const dest = path.join(workdir, "x.svg");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await save({ kind: "base64", data: svg.toString("base64") }, dest);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/active content/i);
  });

  it("keeps the base64 payload out of the audit log", async () => {
    const dest = path.join(workdir, "audited.png");
    const b64 = PNG.toString("base64");
    await save({ kind: "base64", data: b64 }, dest);
    const entry = gw.audit.readAll().find((e) => e.tool === "asset_save_image");
    expect(entry).toBeDefined();
    expect(entry!.inputSummary).not.toContain(b64.slice(0, 32));
    expect(entry!.inputSummary).toMatch(/base64Len/);
  });

  it("backs up an existing file on overwrite", async () => {
    const dest = path.join(workdir, "dup.png");
    fs.writeFileSync(dest, Buffer.from("old"));
    const ok = await save({ kind: "base64", data: PNG.toString("base64") }, dest, true);
    expect(ok.ok).toBe(true);
    expect((ok.data as { backupId?: string }).backupId).toBeDefined();
    // Without overwrite, refuses.
    const refuse = await save({ kind: "base64", data: PNG.toString("base64") }, dest, false);
    expect(refuse.ok).toBe(false);
    expect(refuse.error).toMatch(/exists/i);
  });
});

describe("asset chunk upload", () => {
  it("assembles multiple base64 chunks and writes through normal image validation", async () => {
    const uploadId = "chatgpt-generated-001";
    const b64 = PNG.toString("base64");
    const first = b64.slice(0, 12);
    const second = b64.slice(12);
    const one = await uploadChunk({ uploadId, index: 0, data: first });
    expect(one.ok).toBe(true);
    const two = await uploadChunk({ uploadId, index: 1, data: second });
    expect(two.ok).toBe(true);

    const dest = path.join(workdir, "chunked.png");
    const res = await commitUpload({ uploadId, chunks: 2, destination: dest, overwrite: false });
    expect(res.ok).toBe(true);
    const data = res.data as { path: string; mimeType: string; bytes: number; source: string };
    expect(data.path).toBe(dest);
    expect(data.mimeType).toBe("image/png");
    expect(data.bytes).toBe(PNG.length);
    expect(data.source).toBe(`chunked:${uploadId}`);
    expect(fs.readFileSync(dest)).toEqual(PNG);
  });

  it("keeps chunk payloads out of the audit log", async () => {
    const uploadId = "audit-chunk";
    const b64 = PNG.toString("base64");
    await uploadChunk({ uploadId, index: 0, data: b64 });
    const entry = gw.audit.readAll().find((e) => e.tool === "asset_upload_chunk");
    expect(entry).toBeDefined();
    expect(entry!.inputSummary).not.toContain(b64.slice(0, 24));
    expect(entry!.inputSummary).toContain("base64Len");
  });
});

describe("asset_save_image — latest_download source", () => {
  it("adopts the newest matching image from the downloads dir", async () => {
    const downloads = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-dl-"));
    gw.saveConfig({ ...gw.config(), assets: { ...gw.config().assets, downloadsDir: downloads } });

    fs.writeFileSync(path.join(downloads, "old.png"), PNG);
    const newest = path.join(downloads, "new.png");
    fs.writeFileSync(newest, PNG);
    const future = Date.now() / 1000 + 10;
    fs.utimesSync(newest, future, future);

    const dest = path.join(workdir, "adopted.png");
    const res = await save({ kind: "latest_download" }, dest);
    expect(res.ok).toBe(true);
    const data = res.data as { source: string; mimeType: string };
    expect(path.basename(data.source)).toBe("new.png");
    expect(data.mimeType).toBe("image/png");
    expect(fs.existsSync(dest)).toBe(true);
    fs.rmSync(downloads, { recursive: true, force: true });
  });

  it("errors when no matching image exists", async () => {
    const downloads = fs.mkdtempSync(path.join(process.cwd(), ".tmp-tests", "asset-dl-empty-"));
    gw.saveConfig({ ...gw.config(), assets: { ...gw.config().assets, downloadsDir: downloads } });
    const res = await save({ kind: "latest_download" }, path.join(workdir, "x.png"));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no matching image/i);
    fs.rmSync(downloads, { recursive: true, force: true });
  });
});
